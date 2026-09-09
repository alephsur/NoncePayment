//! NoncePayment — offline-capable USDC "cash notes" on Solana.
//!
//! ## Modelo
//!
//! Un `Slot` es un billete: una cantidad de USDC bloqueada en un vault PDA, emparejada
//! con un *durable nonce account* de uso único y con una *clave de dispositivo*
//! autorizada a gastarlo.
//!
//! - **ONLINE**  `open_slot` — el owner (wallet real, vía Mobile Wallet Adapter) bloquea
//!   fondos y delega el gasto en `authorized_signer` (una clave que vive en el
//!   almacenamiento seguro del móvil, protegida por biometría).
//! - **OFFLINE** el móvil firma una transacción `redeem` completa usando el nonce
//!   cacheado. La transacción NO CADUCA. Se transmite por NFC/BLE/QR.
//! - **ONLINE**  cualquiera de las dos partes envía la transacción. `redeem` paga al
//!   destinatario, devuelve el cambio al owner y cierra el slot.
//!
//! ## Por qué no hay doble gasto (a nivel de protocolo)
//!
//! Avanzar un nonce account invalida cualquier otra transacción firmada contra el valor
//! anterior de ese nonce. Como cada slot tiene exactamente un nonce, cada billete se
//! puede canjear como máximo una vez. Lo garantiza el runtime de Solana, no nosotros.
//!
//! El riesgo residual (firmar dos vouchers contra el mismo slot para dos receptores
//! distintos) está analizado en `docs/THREAT-MODEL.md`. Está acotado a la denominación
//! de un solo billete y es atribuible on-chain.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

// TODO: reemplazar tras `anchor keys sync` (día 5 del roadmap).
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// Un nonce account del System Program ocupa exactamente 80 bytes.
const NONCE_ACCOUNT_LEN: usize = 80;

#[program]
pub mod nonce_payment {
    use super::*;

    /// ONLINE. Bloquea `amount` en un vault PDA y crea el billete.
    ///
    /// El `nonce_account` debe haberse creado e inicializado en la MISMA transacción
    /// (o antes) con `authorized_signer` como nonce authority. Se valida
    /// estructuralmente aquí para que un voucher firmado offline sea siempre canjeable.
    pub fn open_slot(ctx: Context<OpenSlot>, index: u16, amount: u64) -> Result<()> {
        require!(amount > 0, NpError::ZeroAmount);

        let nonce_info = ctx.accounts.nonce_account.to_account_info();
        require_keys_eq!(
            *nonce_info.owner,
            system_program::ID,
            NpError::BadNonceAccount
        );
        require!(
            nonce_info.data_len() == NONCE_ACCOUNT_LEN,
            NpError::BadNonceAccount
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let slot = &mut ctx.accounts.slot;
        slot.owner = ctx.accounts.owner.key();
        slot.authorized_signer = ctx.accounts.authorized_signer.key();
        slot.nonce_account = nonce_info.key();
        slot.mint = ctx.accounts.mint.key();
        slot.amount = amount;
        slot.index = index;
        slot.bump = ctx.bumps.slot;
        slot.vault_bump = ctx.bumps.vault;
        slot.created_at = Clock::get()?.unix_timestamp;

        emit!(SlotOpened {
            owner: slot.owner,
            authorized_signer: slot.authorized_signer,
            nonce_account: slot.nonce_account,
            index,
            amount,
        });

        Ok(())
    }

    /// Firmada OFFLINE por `authorized_signer`, enviada a la red por cualquiera.
    ///
    /// Paga `amount` al destinatario, devuelve el cambio al owner y cierra el billete.
    pub fn redeem(ctx: Context<Redeem>, amount: u64) -> Result<()> {
        let slot = &ctx.accounts.slot;

        require!(amount > 0, NpError::ZeroAmount);
        require!(amount <= slot.amount, NpError::AmountExceedsSlot);

        // Copiamos lo que necesitamos antes de construir las signer seeds, para no
        // mantener un préstamo vivo sobre la cuenta mientras se cierra.
        let owner = slot.owner;
        let index = slot.index;
        let bump = slot.bump;
        let total = slot.amount;

        let index_bytes = index.to_le_bytes();
        let seeds: &[&[u8]] = &[b"slot", owner.as_ref(), index_bytes.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        // 1. Pagar al destinatario.
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_ata.to_account_info(),
                    authority: ctx.accounts.slot.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        // 2. Devolver el cambio al owner.
        let change = total.checked_sub(amount).ok_or(NpError::MathOverflow)?;
        if change > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.owner_ata.to_account_info(),
                        authority: ctx.accounts.slot.to_account_info(),
                    },
                    signer_seeds,
                ),
                change,
            )?;
        }

        // 3. Cerrar el vault; la renta vuelve al owner.
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.owner.to_account_info(),
                authority: ctx.accounts.slot.to_account_info(),
            },
            signer_seeds,
        ))?;

        emit!(SlotRedeemed {
            owner,
            index,
            recipient: ctx.accounts.recipient.key(),
            amount,
            change,
        });

        // El slot se cierra por la constraint `close = owner`.
        Ok(())
    }

    /// ONLINE. El owner recupera un billete no gastado (fondos + renta).
    pub fn reclaim(ctx: Context<Reclaim>) -> Result<()> {
        let slot = &ctx.accounts.slot;
        let owner = slot.owner;
        let index = slot.index;
        let bump = slot.bump;
        let amount = slot.amount;

        let index_bytes = index.to_le_bytes();
        let seeds: &[&[u8]] = &[b"slot", owner.as_ref(), index_bytes.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        if amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.owner_ata.to_account_info(),
                        authority: ctx.accounts.slot.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
            )?;
        }

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.owner.to_account_info(),
                authority: ctx.accounts.slot.to_account_info(),
            },
            signer_seeds,
        ))?;

        emit!(SlotReclaimed { owner, index, amount });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

#[account]
pub struct Slot {
    /// Wallet real del usuario (Seed Vault). Recibe el cambio y la renta.
    pub owner: Pubkey,
    /// Clave de dispositivo autorizada a gastar este billete offline.
    pub authorized_signer: Pubkey,
    /// Durable nonce account emparejado. De uso único: es lo que impide el doble gasto.
    pub nonce_account: Pubkey,
    pub mint: Pubkey,
    /// Colateral bloqueado en el vault, en unidades mínimas del token.
    pub amount: u64,
    pub index: u16,
    pub bump: u8,
    pub vault_bump: u8,
    pub created_at: i64,
}

impl Slot {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 8 + 2 + 1 + 1 + 8; // = 148
}

// ---------------------------------------------------------------------------
// Contextos
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct OpenSlot<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: solo se registra como firmante autorizado. No firma esta instrucción.
    pub authorized_signer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Slot::LEN,
        seeds = [b"slot", owner.key().as_ref(), &index.to_le_bytes()],
        bump
    )]
    pub slot: Account<'info, Slot>,

    #[account(
        init,
        payer = owner,
        token::mint = mint,
        token::authority = slot,
        seeds = [b"vault", slot.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_ata: Account<'info, TokenAccount>,

    /// CHECK: validado en el handler (System-owned, 80 bytes).
    pub nonce_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    /// Clave de dispositivo. Firmó esta transacción OFFLINE.
    pub authorized_signer: Signer<'info>,

    /// CHECK: recibe cambio y renta. Su identidad se valida con `has_one`.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,

    #[account(
        mut,
        close = owner,
        has_one = owner @ NpError::WrongOwner,
        has_one = authorized_signer @ NpError::UnauthorizedSigner,
        has_one = mint @ NpError::WrongMint,
    )]
    pub slot: Account<'info, Slot>,

    #[account(
        mut,
        seeds = [b"vault", slot.key().as_ref()],
        bump = slot.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    /// CHECK: identidad del destinatario. Fijada en el momento de firmar offline y
    /// verificable por el receptor leyendo la lista de cuentas de la transacción.
    pub recipient: UncheckedAccount<'info>,

    /// El ATA se crea de forma idempotente en una instrucción previa de la misma tx.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        close = owner,
        has_one = owner @ NpError::WrongOwner,
        has_one = mint @ NpError::WrongMint,
    )]
    pub slot: Account<'info, Slot>,

    #[account(
        mut,
        seeds = [b"vault", slot.key().as_ref()],
        bump = slot.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

#[event]
pub struct SlotOpened {
    pub owner: Pubkey,
    pub authorized_signer: Pubkey,
    pub nonce_account: Pubkey,
    pub index: u16,
    pub amount: u64,
}

#[event]
pub struct SlotRedeemed {
    pub owner: Pubkey,
    pub index: u16,
    pub recipient: Pubkey,
    pub amount: u64,
    pub change: u64,
}

#[event]
pub struct SlotReclaimed {
    pub owner: Pubkey,
    pub index: u16,
    pub amount: u64,
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

#[error_code]
pub enum NpError {
    #[msg("El importe debe ser mayor que cero")]
    ZeroAmount,
    #[msg("El importe supera el colateral del billete")]
    AmountExceedsSlot,
    #[msg("La cuenta indicada no es un nonce account valido del System Program")]
    BadNonceAccount,
    #[msg("El owner no corresponde a este billete")]
    WrongOwner,
    #[msg("Este firmante no esta autorizado a gastar el billete")]
    UnauthorizedSigner,
    #[msg("El mint no corresponde a este billete")]
    WrongMint,
    #[msg("Overflow aritmetico")]
    MathOverflow,
}
