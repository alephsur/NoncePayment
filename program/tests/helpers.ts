/**
 * Shared utilities for the program suite.
 *
 * The PDA seeds are recomputed here by hand, deliberately: if someone changes the
 * program's seeds without touching these, the tests break. It's the only way the SDK
 * and the program don't drift apart in silence.
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
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  mintTo,
} from '@solana/spl-token';

import { NoncePayment } from '../target/types/nonce_payment';

export const USDC_DECIMALS = 6;

/** Readable amounts: usdc(20) is 20 USDC in minor units. */
export const usdc = (n: number) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));

export const bn = (v: bigint) => new anchor.BN(v.toString());

/**
 * Slot indices are per owner, and every test file shares the same validator. If each
 * context started counting from zero, the second file would collide with the first
 * file's PDAs. Hence a module-level counter.
 */
let nextSlotIndex = 0;

export function slotPda(
  programId: PublicKey,
  owner: PublicKey,
  index: number,
): [PublicKey, number] {
  const le = Buffer.alloc(2);
  le.writeUInt16LE(index);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('slot'), owner.toBuffer(), le],
    programId,
  );
}

export function vaultPda(programId: PublicKey, slot: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), slot.toBuffer()],
    programId,
  );
}

/**
 * The common scenario: an owner holding fake USDC, a device key, and the machinery to
 * open banknotes. Built once per test file.
 */
export class TestContext {
  readonly program: Program<NoncePayment>;
  readonly provider: anchor.AnchorProvider;
  /**
   * The provider wallet. It pays for the test scaffolding (mints, ATAs, nonces) so that
   * the owner's balance only moves for what we're actually measuring.
   */
  readonly payer: Keypair;
  /**
   * The user's wallet. A fresh keypair, NOT the provider's, and that matters: the
   * provider wallet accumulates hundreds of millions of SOL from airdrops, and its
   * lamport balance goes past Number.MAX_SAFE_INTEGER. Measuring it in JavaScript gives
   * rounding errors of tens of lamports — enough to fail a rent assertion for reasons
   * that have nothing to do with the program.
   */
  readonly owner: Keypair;
  /** Device key: in the app it lives in secure storage, behind biometrics. */
  readonly deviceKey: Keypair;
  mint!: PublicKey;
  ownerAta!: PublicKey;

  private constructor() {
    anchor.setProvider(anchor.AnchorProvider.env());
    this.provider = anchor.getProvider() as anchor.AnchorProvider;
    this.program = anchor.workspace.NoncePayment as Program<NoncePayment>;
    this.payer = (this.provider.wallet as anchor.Wallet).payer;
    this.owner = Keypair.generate();
    this.deviceKey = Keypair.generate();
  }

  get conn() {
    return this.provider.connection;
  }

  static async create(initialBalance = 1000): Promise<TestContext> {
    const ctx = new TestContext();

    // The owner needs SOL for slot and vault rent. The device key needs it for voucher
    // fees and the recipient's ATA rent; the app prefunds it when loading banknotes
    // (see DEVICE_KEY_FUNDING_LAMPORTS in the SDK).
    await ctx.fund([
      [ctx.owner.publicKey, 10 * LAMPORTS_PER_SOL],
      [ctx.deviceKey.publicKey, 0.5 * LAMPORTS_PER_SOL],
    ]);

    // Fake USDC: same decimals, so the amounts read the same.
    ctx.mint = await createMint(ctx.conn, ctx.payer, ctx.payer.publicKey, null, USDC_DECIMALS);
    ctx.ownerAta = await createAssociatedTokenAccount(
      ctx.conn,
      ctx.payer,
      ctx.mint,
      ctx.owner.publicKey,
    );
    await mintTo(
      ctx.conn,
      ctx.payer,
      ctx.mint,
      ctx.ownerAta,
      ctx.payer,
      Number(usdc(initialBalance)),
    );
    return ctx;
  }

  private async fund(destinations: [PublicKey, number][]) {
    const tx = new Transaction().add(
      ...destinations.map(([toPubkey, lamports]) =>
        SystemProgram.transfer({ fromPubkey: this.payer.publicKey, toPubkey, lamports }),
      ),
    );
    await sendAndConfirmTransaction(this.conn, tx, [this.payer]);
  }

  /**
   * Sends instructions with the device key as fee payer, which is how a real voucher
   * travels: the owner isn't present when it's redeemed.
   */
  async sendAsDevice(ixs: TransactionInstruction[]): Promise<string> {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = this.deviceKey.publicKey;
    return sendAndConfirmTransaction(this.conn, tx, [this.deviceKey]);
  }

  /** One index per banknote: two slots of the same owner can't share one. */
  takeIndex(): number {
    return nextSlotIndex++;
  }

  /**
   * Creates and initializes a durable nonce with `authority` as the nonce authority.
   * The provider pays for it, not the owner, to keep the rent measurements clean.
   */
  async createNonceAccount(authority: PublicKey): Promise<Keypair> {
    const nonceKp = Keypair.generate();
    const lamports = await this.conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
    const tx = SystemProgram.createNonceAccount({
      fromPubkey: this.payer.publicKey,
      noncePubkey: nonceKp.publicKey,
      authorizedPubkey: authority,
      lamports,
    });
    await sendAndConfirmTransaction(this.conn, tx, [this.payer, nonceKp]);
    return nonceKp;
  }

  /** Opens a banknote and returns everything needed to spend it later. */
  async openSlot(amount: bigint, opts: { authorizedSigner?: PublicKey } = {}) {
    const index = this.takeIndex();
    const signer = opts.authorizedSigner ?? this.deviceKey.publicKey;
    const [slot] = slotPda(this.program.programId, this.owner.publicKey, index);
    const [vault] = vaultPda(this.program.programId, slot);
    const nonce = await this.createNonceAccount(signer);

    await this.program.methods
      .openSlot(index, bn(amount))
      .accountsPartial({
        owner: this.owner.publicKey,
        authorizedSigner: signer,
        slot,
        vault,
        mint: this.mint,
        ownerAta: this.ownerAta,
        nonceAccount: nonce.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([this.owner])
      .rpc();

    return { index, slot, vault, nonce, amount };
  }
}
