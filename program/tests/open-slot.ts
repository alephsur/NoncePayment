/**
 * Roadmap day 5 — `open_slot`.
 *
 * A banknote is a `Slot`: collateral locked in a vault PDA, paired with a single-use
 * durable nonce and with the device key allowed to spend it. This checks that opening
 * one leaves exactly that state, and that it can't be opened against something that
 * isn't a nonce.
 */
import { Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAccount } from '@solana/spl-token';
import { assert } from 'chai';

import { TestContext, bn, slotPda, usdc, vaultPda } from './helpers';

describe('open_slot', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await TestContext.create();
  });

  it('opens a banknote and locks the collateral in the vault', async () => {
    const before = await getAccount(ctx.conn, ctx.ownerAta);
    const note = await ctx.openSlot(usdc(20));

    // The collateral left the owner and sits in the vault.
    const after = await getAccount(ctx.conn, ctx.ownerAta);
    assert.equal(before.amount - after.amount, usdc(20), 'the owner did not pay the collateral');
    assert.equal((await getAccount(ctx.conn, note.vault)).amount, usdc(20), 'the vault did not receive it');

    // And the banknote points at who it should point at.
    const state = await ctx.program.account.slot.fetch(note.slot);
    assert.ok(state.owner.equals(ctx.owner.publicKey));
    assert.ok(state.authorizedSigner.equals(ctx.deviceKey.publicKey), 'wrong signer');
    assert.ok(state.nonceAccount.equals(note.nonce.publicKey), 'wrong nonce');
    assert.ok(state.mint.equals(ctx.mint));
    assert.equal(state.amount.toString(), usdc(20).toString());
    assert.equal(state.index, note.index);
  });

  it('allows several banknotes at once, one per index', async () => {
    const a = await ctx.openSlot(usdc(5));
    const b = await ctx.openSlot(usdc(50));

    assert.notEqual(a.index, b.index);
    assert.equal((await ctx.program.account.slot.fetch(a.slot)).amount.toString(), usdc(5).toString());
    assert.equal((await ctx.program.account.slot.fetch(b.slot)).amount.toString(), usdc(50).toString());
  });

  it('REJECTS a banknote worth zero', async () => {
    try {
      await ctx.openSlot(0n);
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
    const index = ctx.takeIndex();
    const [slot] = slotPda(ctx.program.programId, ctx.owner.publicKey, index);
    const [vault] = vaultPda(ctx.program.programId, slot);

    // A System Program account, but the wrong size.
    const fake = Keypair.generate();
    const lamports = await ctx.conn.getMinimumBalanceForRentExemption(64);
    await sendAndConfirmTransaction(
      ctx.conn,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: ctx.payer.publicKey,
          newAccountPubkey: fake.publicKey,
          lamports,
          space: 64,
          programId: SystemProgram.programId,
        }),
      ),
      [ctx.payer, fake],
    );

    try {
      await ctx.program.methods
        .openSlot(index, bn(usdc(1)))
        .accountsPartial({
          owner: ctx.owner.publicKey,
          authorizedSigner: ctx.deviceKey.publicKey,
          slot,
          vault,
          mint: ctx.mint,
          ownerAta: ctx.ownerAta,
          nonceAccount: fake.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([ctx.owner])
        .rpc();
      assert.fail('an account that is not a nonce was accepted');
    } catch (e: any) {
      assert.equal(e.error?.errorCode?.code, 'BadNonceAccount', e.message);
    }
  });

  it('REJECTS collateral larger than the owner balance', async () => {
    try {
      await ctx.openSlot(usdc(1_000_000));
      assert.fail('more money than exists was locked up');
    } catch (e: any) {
      // The SPL Token program rejects this one, not ours.
      assert.match(e.message ?? String(e), /insufficient funds|0x1\b/i, e.message);
    }
  });
});
