/**
 * Roadmap day 7 — `reclaim`.
 *
 * The way out. A banknote that was loaded and never spent has USDC and rent sitting
 * locked in a vault; `reclaim` is how the owner gets both back. It's the instruction
 * that keeps "loading cash" from being a one-way door, so it matters more for trust
 * than its size suggests.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
} from '@solana/spl-token';
import { assert } from 'chai';

import { TestContext, USDC_DECIMALS, usdc } from './helpers';

describe('reclaim', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await TestContext.create();
  });

  function reclaim(args: {
    slot: PublicKey;
    vault: PublicKey;
    owner?: PublicKey;
    mint?: PublicKey;
    ownerAta?: PublicKey;
    signers?: Keypair[];
  }) {
    return ctx.program.methods
      .reclaim()
      .accountsPartial({
        owner: args.owner ?? ctx.owner.publicKey,
        slot: args.slot,
        vault: args.vault,
        mint: args.mint ?? ctx.mint,
        ownerAta: args.ownerAta ?? ctx.ownerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers(args.signers ?? [ctx.owner])
      .rpc();
  }

  it('gives the owner back the USDC and the rent of an unspent banknote', async () => {
    const usdcBefore = (await getAccount(ctx.conn, ctx.ownerAta)).amount;
    const note = await ctx.openSlot(usdc(50));

    // While the banknote is open, the money is not in the owner's account.
    assert.equal((await getAccount(ctx.conn, ctx.ownerAta)).amount, usdcBefore - usdc(50));

    const rentLocked =
      (await ctx.conn.getBalance(note.slot)) + (await ctx.conn.getBalance(note.vault));
    const solBefore = await ctx.conn.getBalance(ctx.owner.publicKey);

    await reclaim({ slot: note.slot, vault: note.vault });

    // Every USDC comes back...
    assert.equal((await getAccount(ctx.conn, ctx.ownerAta)).amount, usdcBefore);

    // ...and so does the rent, to the lamport. The provider wallet pays the fee here,
    // so nothing else moves the owner's balance.
    const solAfter = await ctx.conn.getBalance(ctx.owner.publicKey);
    assert.equal(solAfter - solBefore, rentLocked, 'the rent did not come back');

    assert.isNull(await ctx.conn.getAccountInfo(note.slot), 'the slot is still open');
    assert.isNull(await ctx.conn.getAccountInfo(note.vault), 'the vault is still open');
  });

  /**
   * `reclaim` is the owner's escape hatch, so it must not become anyone else's. A
   * stranger who reclaimed a banknote would be draining the owner's wallet.
   */
  it('REJECTS a reclaim by someone who is not the owner', async () => {
    const note = await ctx.openSlot(usdc(5));
    const stranger = Keypair.generate();
    await ctx.airdrop(stranger.publicKey, 1);

    try {
      await reclaim({
        slot: note.slot,
        vault: note.vault,
        owner: stranger.publicKey,
        signers: [stranger],
      });
      assert.fail('a stranger reclaimed the banknote');
    } catch (e: any) {
      assert.equal(e.error?.errorCode?.code, 'WrongOwner', e.message);
    }
  });

  it('REJECTS a reclaim with the wrong mint', async () => {
    const note = await ctx.openSlot(usdc(5));

    // A different token, with its own account for the owner.
    const otherMint = await createMint(
      ctx.conn,
      ctx.payer,
      ctx.payer.publicKey,
      null,
      USDC_DECIMALS,
    );
    const otherAta = await createAssociatedTokenAccount(
      ctx.conn,
      ctx.payer,
      otherMint,
      ctx.owner.publicKey,
    );

    try {
      await reclaim({
        slot: note.slot,
        vault: note.vault,
        mint: otherMint,
        ownerAta: otherAta,
      });
      assert.fail('the banknote was reclaimed against another token');
    } catch (e: any) {
      assert.equal(e.error?.errorCode?.code, 'WrongMint', e.message);
    }
  });

  /**
   * The banknote is gone after being spent, so there is nothing left to reclaim. This
   * is what stops an owner from cashing a note twice: once from the recipient's
   * redeem, once from their own reclaim.
   */
  it('REJECTS reclaiming a banknote that no longer exists', async () => {
    const note = await ctx.openSlot(usdc(5));
    await reclaim({ slot: note.slot, vault: note.vault });

    try {
      await reclaim({ slot: note.slot, vault: note.vault });
      assert.fail('a banknote was reclaimed twice');
    } catch (e: any) {
      assert.match(
        e.message ?? String(e),
        /AccountNotInitialized|could not find account|has no data/i,
        e.message,
      );
    }
  });
});
