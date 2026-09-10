/**
 * Roadmap day 5 — `open_slot`.
 *
 * A banknote is a `Slot`: collateral locked in a vault PDA, paired with a single-use
 * durable nonce and with the device key allowed to spend it. This checks that opening
 * one leaves exactly that state, and that it can't be opened against something that
 * isn't a nonce.
 */
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  mintTo,
} from '@solana/spl-token';
import { assert } from 'chai';

import { NoncePayment } from '../target/types/nonce_payment';

const USDC_DECIMALS = 6;
const usdc = (n: number) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));

describe('open_slot', () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.NoncePayment as Program<NoncePayment>;
  const conn = provider.connection;

  /** The user's real wallet. In the app it's the Seed Vault one, via Mobile Wallet Adapter. */
  const owner = (provider.wallet as anchor.Wallet).payer;
  /** Device key: lives in the phone's secure storage, behind biometrics. */
  const deviceKey = Keypair.generate();

  let mint: PublicKey;
  let ownerAta: PublicKey;
  let nextIndex = 0;

  /** The banknote's PDAs. They have to match the program's and the SDK's seeds. */
  function slotPda(index: number): [PublicKey, number] {
    const le = Buffer.alloc(2);
    le.writeUInt16LE(index);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('slot'), owner.publicKey.toBuffer(), le],
      program.programId,
    );
  }

  function vaultPda(slot: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), slot.toBuffer()],
      program.programId,
    );
  }

  /** Creates and initializes a durable nonce with the device key as its authority. */
  async function createNonceAccount(authority: PublicKey): Promise<Keypair> {
    const nonceKp = Keypair.generate();
    const rent = await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
    const tx = SystemProgram.createNonceAccount({
      fromPubkey: owner.publicKey,
      noncePubkey: nonceKp.publicKey,
      authorizedPubkey: authority,
      lamports: rent,
    });
    await sendAndConfirmTransaction(conn, tx, [owner, nonceKp]);
    return nonceKp;
  }

  before(async () => {
    // Fake USDC: same decimals, so the amounts read the same.
    mint = await createMint(conn, owner, owner.publicKey, null, USDC_DECIMALS);
    ownerAta = await createAssociatedTokenAccount(conn, owner, mint, owner.publicKey);
    await mintTo(conn, owner, mint, ownerAta, owner, Number(usdc(1000)));
  });

  it('opens a banknote and locks the collateral in the vault', async () => {
    const index = nextIndex++;
    const amount = usdc(20);
    const [slot] = slotPda(index);
    const [vault] = vaultPda(slot);
    const nonce = await createNonceAccount(deviceKey.publicKey);

    const before = await getAccount(conn, ownerAta);

    await program.methods
      .openSlot(index, new anchor.BN(amount.toString()))
      .accountsPartial({
        owner: owner.publicKey,
        authorizedSigner: deviceKey.publicKey,
        slot,
        vault,
        mint,
        ownerAta,
        nonceAccount: nonce.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // The collateral left the owner and sits in the vault.
    const after = await getAccount(conn, ownerAta);
    assert.equal(before.amount - after.amount, amount, 'the owner did not pay the collateral');
    assert.equal((await getAccount(conn, vault)).amount, amount, 'the vault did not receive it');

    // And the banknote points at who it should point at.
    const state = await program.account.slot.fetch(slot);
    assert.ok(state.owner.equals(owner.publicKey));
    assert.ok(state.authorizedSigner.equals(deviceKey.publicKey), 'wrong signer');
    assert.ok(state.nonceAccount.equals(nonce.publicKey), 'wrong nonce');
    assert.ok(state.mint.equals(mint));
    assert.equal(state.amount.toString(), amount.toString());
    assert.equal(state.index, index);
  });

  it('allows several banknotes at once, one per index', async () => {
    const index = nextIndex++;
    const [slot] = slotPda(index);
    const [vault] = vaultPda(slot);
    const nonce = await createNonceAccount(deviceKey.publicKey);

    await program.methods
      .openSlot(index, new anchor.BN(usdc(5).toString()))
      .accountsPartial({
        owner: owner.publicKey,
        authorizedSigner: deviceKey.publicKey,
        slot,
        vault,
        mint,
        ownerAta,
        nonceAccount: nonce.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    assert.equal((await program.account.slot.fetch(slot)).amount.toString(), usdc(5).toString());
  });

  it('REJECTS a banknote worth zero', async () => {
    const index = nextIndex++;
    const [slot] = slotPda(index);
    const [vault] = vaultPda(slot);
    const nonce = await createNonceAccount(deviceKey.publicKey);

    try {
      await program.methods
        .openSlot(index, new anchor.BN(0))
        .accountsPartial({
          owner: owner.publicKey,
          authorizedSigner: deviceKey.publicKey,
          slot,
          vault,
          mint,
          ownerAta,
          nonceAccount: nonce.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail('a worthless banknote was opened');
    } catch (e: any) {
      assert.equal(e.error?.errorCode?.code, 'ZeroAmount', e.message);
    }
  });

  /**
   * Why this validation exists: a voucher is signed OFFLINE against the cached nonce.
   * If an account that isn't a nonce slipped through when the banknote was opened, that
   * voucher would be unredeemable and the money would sit dead in the vault. It's
   * checked at open time, while there's still network to fail visibly.
   */
  it('REJECTS an account that is not a nonce account', async () => {
    const index = nextIndex++;
    const [slot] = slotPda(index);
    const [vault] = vaultPda(slot);

    // A System Program account, but the wrong size.
    const fake = Keypair.generate();
    const rent = await conn.getMinimumBalanceForRentExemption(64);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: fake.publicKey,
          lamports: rent,
          space: 64,
          programId: SystemProgram.programId,
        }),
      ),
      [owner, fake],
    );

    try {
      await program.methods
        .openSlot(index, new anchor.BN(usdc(1).toString()))
        .accountsPartial({
          owner: owner.publicKey,
          authorizedSigner: deviceKey.publicKey,
          slot,
          vault,
          mint,
          ownerAta,
          nonceAccount: fake.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail('an account that is not a nonce was accepted');
    } catch (e: any) {
      assert.equal(e.error?.errorCode?.code, 'BadNonceAccount', e.message);
    }
  });

  it('REJECTS collateral larger than the owner balance', async () => {
    const index = nextIndex++;
    const [slot] = slotPda(index);
    const [vault] = vaultPda(slot);
    const nonce = await createNonceAccount(deviceKey.publicKey);

    try {
      await program.methods
        .openSlot(index, new anchor.BN(usdc(1_000_000).toString()))
        .accountsPartial({
          owner: owner.publicKey,
          authorizedSigner: deviceKey.publicKey,
          slot,
          vault,
          mint,
          ownerAta,
          nonceAccount: nonce.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail('more money than exists was locked up');
    } catch (e: any) {
      // The SPL Token program rejects this one, not ours.
      assert.match(e.message ?? String(e), /insufficient funds|0x1\b/i, e.message);
    }
  });
});
