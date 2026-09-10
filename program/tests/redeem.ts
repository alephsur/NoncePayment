/**
 * Roadmap day 6 — `redeem`, the happy path.
 *
 * `redeem` is what the payer signs OFFLINE and what eventually reaches the chain. This
 * checks it without the nonce in the loop: that it pays the recipient, returns the
 * change, and closes the banknote reclaiming the rent. The nonce comes in on day 8,
 * which is when we prove it can't be collected twice.
 */
import * as anchor from '@coral-xyz/anchor';
import { Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { assert } from 'chai';

import { TestContext, bn, usdc } from './helpers';

describe('redeem', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await TestContext.create();
  });

  /**
   * The recipient may not have a USDC account yet. In the real voucher this rides along
   * as a prior instruction inside the SAME transaction; same thing here.
   */
  async function ensureRecipientAta(recipient: Keypair) {
    const ata = getAssociatedTokenAddressSync(ctx.mint, recipient.publicKey);
    await sendAndConfirmTransaction(
      ctx.conn,
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          ctx.payer.publicKey,
          ata,
          recipient.publicKey,
          ctx.mint,
        ),
      ),
      [ctx.payer],
    );
    return ata;
  }

  /** The `redeem` instruction exactly as a voucher carries it. */
  function redeemIx(args: {
    slot: anchor.web3.PublicKey;
    vault: anchor.web3.PublicKey;
    recipient: anchor.web3.PublicKey;
    recipientAta: anchor.web3.PublicKey;
    amount: bigint;
  }) {
    return ctx.program.methods
      .redeem(bn(args.amount))
      .accountsPartial({
        authorizedSigner: ctx.deviceKey.publicKey,
        owner: ctx.owner.publicKey,
        slot: args.slot,
        vault: args.vault,
        mint: ctx.mint,
        recipient: args.recipient,
        recipientAta: args.recipientAta,
        ownerAta: ctx.ownerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  it('pays the whole banknote and closes it', async () => {
    const note = await ctx.openSlot(usdc(20));
    const recipient = Keypair.generate();
    const recipientAta = await ensureRecipientAta(recipient);

    const ownerBefore = await getAccount(ctx.conn, ctx.ownerAta);

    await ctx.sendAsDevice([
      await redeemIx({
        slot: note.slot,
        vault: note.vault,
        recipient: recipient.publicKey,
        recipientAta,
        amount: usdc(20),
      }),
    ]);

    // The recipient collects the full 20.
    assert.equal((await getAccount(ctx.conn, recipientAta)).amount, usdc(20));

    // There is no change, so the owner gets no USDC back.
    const ownerAfter = await getAccount(ctx.conn, ctx.ownerAta);
    assert.equal(ownerAfter.amount, ownerBefore.amount, 'there should be no change');

    // And the banknote ceases to exist: vault closed and slot closed.
    assert.isNull(await ctx.conn.getAccountInfo(note.vault), 'the vault is still open');
    assert.isNull(await ctx.conn.getAccountInfo(note.slot), 'the slot is still open');
  });

  it('pays part of it and returns the change to the owner', async () => {
    const note = await ctx.openSlot(usdc(20));
    const recipient = Keypair.generate();
    const recipientAta = await ensureRecipientAta(recipient);

    const ownerBefore = await getAccount(ctx.conn, ctx.ownerAta);

    await ctx.sendAsDevice([
      await redeemIx({
        slot: note.slot,
        vault: note.vault,
        recipient: recipient.publicKey,
        recipientAta,
        amount: usdc(5),
      }),
    ]);

    assert.equal((await getAccount(ctx.conn, recipientAta)).amount, usdc(5));

    // The remaining 15 go straight back to the owner. No balance left dangling.
    const ownerAfter = await getAccount(ctx.conn, ctx.ownerAta);
    assert.equal(ownerAfter.amount - ownerBefore.amount, usdc(15), 'wrong change');

    assert.isNull(await ctx.conn.getAccountInfo(note.slot), 'the slot is still open');
  });

  it('returns the slot and vault rent to the owner', async () => {
    const note = await ctx.openSlot(usdc(1));
    const recipient = Keypair.generate();
    const recipientAta = await ensureRecipientAta(recipient);

    const rentLocked =
      (await ctx.conn.getBalance(note.slot)) + (await ctx.conn.getBalance(note.vault));
    assert.isAbove(rentLocked, 0, 'the banknote had no rent locked up');

    const solBefore = await ctx.conn.getBalance(ctx.owner.publicKey);

    // The device key pays, so the owner's balance only moves because of the rent.
    await ctx.sendAsDevice([
      await redeemIx({
        slot: note.slot,
        vault: note.vault,
        recipient: recipient.publicKey,
        recipientAta,
        amount: usdc(1),
      }),
    ]);

    const solAfter = await ctx.conn.getBalance(ctx.owner.publicKey);
    assert.equal(solAfter - solBefore, rentLocked, 'the rent did not come back in full');
  });

  it('the recipient gets paid even with no USDC account', async () => {
    const note = await ctx.openSlot(usdc(5));
    const recipient = Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(ctx.mint, recipient.publicKey);

    assert.isNull(await ctx.conn.getAccountInfo(recipientAta), 'the ATA already existed');

    // Exactly what `buildVoucher` does: create the ATA in the same transaction.
    await ctx.sendAsDevice([
      createAssociatedTokenAccountIdempotentInstruction(
        ctx.deviceKey.publicKey,
        recipientAta,
        recipient.publicKey,
        ctx.mint,
      ),
      await redeemIx({
        slot: note.slot,
        vault: note.vault,
        recipient: recipient.publicKey,
        recipientAta,
        amount: usdc(5),
      }),
    ]);

    assert.equal((await getAccount(ctx.conn, recipientAta)).amount, usdc(5));
  });
});
