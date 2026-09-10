/**
 * Roadmap day 8 — the test that matters most.
 *
 * Everything before this proved pieces. This proves the product: a voucher built with
 * NO NETWORK by the real SDK, against a nonce value cached earlier, still lands on
 * chain long after a normal transaction would have expired — and a second voucher
 * signed against the same banknote is impossible to cash.
 *
 * It also pins the SDK against the program. `buildVoucher` hand-rolls the `redeem`
 * instruction: the Anchor discriminator, the account order, the little-endian amount.
 * If either side drifts, this is where it shows up, rather than on a phone in a demo.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { assert } from 'chai';

import {
  CachedSlot,
  VerificationLevel,
  buildVoucher,
  readNonceValue,
  verifyVoucher,
} from '../../packages/sdk/src';

import { TestContext, usdc } from './helpers';

describe('durable nonce — the offline voucher', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await TestContext.create();
  });

  /** The banknote as the phone caches it after loading. This is all it keeps. */
  async function cacheSlot(note: {
    index: number;
    nonce: Keypair;
    amount: bigint;
  }): Promise<CachedSlot> {
    return {
      index: note.index,
      owner: ctx.owner.publicKey.toBase58(),
      authorizedSigner: ctx.deviceKey.publicKey.toBase58(),
      nonceAccount: note.nonce.publicKey.toBase58(),
      // Read once, while there is still network. From here on it's offline.
      nonceValue: await readNonceValue(ctx.conn, note.nonce.publicKey),
      mint: ctx.mint.toBase58(),
      amount: note.amount.toString(),
      syncedAt: new Date().toISOString(),
      status: 'available',
    };
  }

  /** Waits until a normal blockhash has genuinely expired. No guessed sleeps. */
  async function waitForBlockhashExpiry(blockhash: string): Promise<number> {
    const t0 = Date.now();
    for (;;) {
      const { value: valid } = await ctx.conn.isBlockhashValid(blockhash, {
        commitment: 'confirmed',
      });
      if (!valid) return Math.round((Date.now() - t0) / 1000);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  it('a voucher signed offline is still valid long after a normal tx would have expired', async () => {
    const note = await ctx.openSlot(usdc(20));
    const cached = await cacheSlot(note);
    const recipient = Keypair.generate();

    // --- From here on, pretend there is no network. -------------------------
    // A control blockhash captured at the same instant, to prove the wait was real.
    const { blockhash: control } = await ctx.conn.getLatestBlockhash('confirmed');

    const voucher = buildVoucher({
      slot: cached,
      deviceKey: ctx.deviceKey,
      recipient: recipient.publicKey,
      amount: usdc(20),
    });

    // The recipient checks it without network too, before handing over the goods.
    const verified = verifyVoucher(voucher, recipient.publicKey);
    assert.equal(verified.level, VerificationLevel.CRYPTO_ONLY);
    assert.equal(verified.amount, usdc(20));
    assert.ok(verified.recipient.equals(recipient.publicKey));
    assert.ok(verified.slot.equals(note.slot), 'the SDK derived a different slot PDA');

    // A QR has to be able to carry it.
    assert.isBelow(voucher.tx.length, 2300, 'the voucher does not fit in a QR');

    // --- Time passes. -------------------------------------------------------
    const waited = await waitForBlockhashExpiry(control);
    assert.isAbove(waited, 0);

    // --- Network is back. Anyone can push it. -------------------------------
    const raw = Buffer.from(voucher.tx, 'base64');
    const sig = await ctx.conn.sendRawTransaction(raw);
    await ctx.conn.confirmTransaction(sig, 'confirmed');

    const recipientAta = getAssociatedTokenAddressSync(ctx.mint, recipient.publicKey);
    assert.equal((await getAccount(ctx.conn, recipientAta)).amount, usdc(20));

    // The banknote is gone.
    assert.isNull(await ctx.conn.getAccountInfo(note.slot), 'the slot is still open');
  });

  /**
   * THE guarantee of the product. Two vouchers, same banknote, two recipients — the
   * scenario a dishonest payer would try offline, where nobody can check anything.
   * Both are cryptographically perfect. Only one can ever be cashed, and Solana's
   * runtime is what enforces it: advancing the nonce invalidates the other.
   */
  it('a SECOND voucher against the same banknote cannot be cashed', async () => {
    const note = await ctx.openSlot(usdc(20));
    const cached = await cacheSlot(note);

    const alice = Keypair.generate();
    const bob = Keypair.generate();

    // Both signed offline, from the same cached banknote, against the same nonce.
    const toAlice = buildVoucher({
      slot: cached,
      deviceKey: ctx.deviceKey,
      recipient: alice.publicKey,
      amount: usdc(20),
    });
    const toBob = buildVoucher({
      slot: cached,
      deviceKey: ctx.deviceKey,
      recipient: bob.publicKey,
      amount: usdc(20),
    });

    // Both verify offline. Neither Alice nor Bob can tell there is a problem.
    assert.equal(verifyVoucher(toAlice, alice.publicKey).amount, usdc(20));
    assert.equal(verifyVoucher(toBob, bob.publicKey).amount, usdc(20));

    // Whoever reaches the network first gets paid.
    const sig = await ctx.conn.sendRawTransaction(Buffer.from(toAlice.tx, 'base64'));
    await ctx.conn.confirmTransaction(sig, 'confirmed');

    // And the other one is dead on arrival.
    try {
      await ctx.conn.sendRawTransaction(Buffer.from(toBob.tx, 'base64'), {
        skipPreflight: false,
      });
      assert.fail('the same banknote was cashed twice');
    } catch (e: any) {
      assert.match(
        String(e.message ?? e),
        /Blockhash not found/i,
        'it failed, but not because of the nonce: ' + e.message,
      );
    }

    // Alice has the money, Bob has nothing — not even an account.
    const aliceAta = getAssociatedTokenAddressSync(ctx.mint, alice.publicKey);
    assert.equal((await getAccount(ctx.conn, aliceAta)).amount, usdc(20));
    const bobAta = getAssociatedTokenAddressSync(ctx.mint, bob.publicKey);
    assert.isNull(await ctx.conn.getAccountInfo(bobAta), 'Bob got paid too');
  });
});
