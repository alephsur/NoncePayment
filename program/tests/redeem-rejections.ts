/**
 * Roadmap day 7 — everything `redeem` has to refuse.
 *
 * A voucher is signed offline and handed to a stranger, so every one of these is an
 * attack someone can actually attempt: forge the amount, sign with a key that isn't
 * the authorized one, point the banknote at a different owner or a different token.
 * The program is the last line; there is no server behind it.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { assert } from 'chai';

import { TestContext, USDC_DECIMALS, anchorErrorCode, bn, usdc } from './helpers';

describe('redeem — rejections', () => {
  let ctx: TestContext;
  let recipient: Keypair;
  let recipientAta: PublicKey;

  before(async () => {
    ctx = await TestContext.create();
    recipient = Keypair.generate();
    recipientAta = await createAssociatedTokenAccount(
      ctx.conn,
      ctx.payer,
      ctx.mint,
      recipient.publicKey,
    );
  });

  function redeemIx(args: {
    slot: PublicKey;
    vault: PublicKey;
    amount: bigint;
    authorizedSigner?: PublicKey;
    owner?: PublicKey;
    mint?: PublicKey;
    ownerAta?: PublicKey;
    recipientAta?: PublicKey;
  }) {
    return ctx.program.methods
      .redeem(bn(args.amount))
      .accountsPartial({
        authorizedSigner: args.authorizedSigner ?? ctx.deviceKey.publicKey,
        owner: args.owner ?? ctx.owner.publicKey,
        slot: args.slot,
        vault: args.vault,
        mint: args.mint ?? ctx.mint,
        recipient: recipient.publicKey,
        recipientAta: args.recipientAta ?? recipientAta,
        ownerAta: args.ownerAta ?? ctx.ownerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /** Runs a redeem that is expected to fail, and returns the error. */
  async function expectFailure(ix: Promise<any>, signer?: Keypair) {
    const instruction = await ix;
    try {
      if (signer) {
        await ctx.sendAs(signer, [instruction]);
      } else {
        await ctx.sendAsDevice([instruction]);
      }
    } catch (e: any) {
      return e;
    }
    return null;
  }

  it('REJECTS an amount of zero', async () => {
    const note = await ctx.openSlot(usdc(10));
    const e = await expectFailure(
      redeemIx({ slot: note.slot, vault: note.vault, amount: 0n }),
    );
    assert.isNotNull(e, 'a payment of zero went through');
    assert.equal(anchorErrorCode(e), 'ZeroAmount', e.message);
  });

  /**
   * The one that actually protects the owner: a voucher can never be worth more than
   * the banknote backing it. Without this, a compromised device key would drain
   * whatever happened to sit in the vault.
   */
  it('REJECTS an amount above the value of the banknote', async () => {
    const note = await ctx.openSlot(usdc(10));
    const e = await expectFailure(
      redeemIx({ slot: note.slot, vault: note.vault, amount: usdc(10.000001) }),
    );
    assert.isNotNull(e, 'more than the banknote was paid out');
    assert.equal(anchorErrorCode(e), 'AmountExceedsSlot', e.message);
  });

  /** Someone else's device key is just someone else's key. */
  it('REJECTS a signer that is not the authorized one', async () => {
    const note = await ctx.openSlot(usdc(10));
    const impostor = Keypair.generate();
    await ctx.airdrop(impostor.publicKey, 1);

    const e = await expectFailure(
      redeemIx({
        slot: note.slot,
        vault: note.vault,
        amount: usdc(1),
        authorizedSigner: impostor.publicKey,
      }),
      impostor,
    );
    assert.isNotNull(e, 'an unauthorized key spent the banknote');
    assert.equal(anchorErrorCode(e), 'UnauthorizedSigner', e.message);
  });

  /**
   * The owner receives the change and the rent, so pointing that at another account
   * would be a way to redirect someone else's money.
   */
  it('REJECTS an owner that does not match the banknote', async () => {
    const note = await ctx.openSlot(usdc(10));
    const stranger = Keypair.generate();
    const strangerAta = await createAssociatedTokenAccount(
      ctx.conn,
      ctx.payer,
      ctx.mint,
      stranger.publicKey,
    );

    const e = await expectFailure(
      redeemIx({
        slot: note.slot,
        vault: note.vault,
        amount: usdc(1),
        owner: stranger.publicKey,
        ownerAta: strangerAta,
      }),
    );
    assert.isNotNull(e, 'the change went to somebody else');
    assert.equal(anchorErrorCode(e), 'WrongOwner', e.message);
  });

  it('REJECTS a mint that does not match the banknote', async () => {
    const note = await ctx.openSlot(usdc(10));

    const otherMint = await createMint(
      ctx.conn,
      ctx.payer,
      ctx.payer.publicKey,
      null,
      USDC_DECIMALS,
    );
    const otherOwnerAta = await createAssociatedTokenAccount(
      ctx.conn,
      ctx.payer,
      otherMint,
      ctx.owner.publicKey,
    );
    const otherRecipientAta = await createAssociatedTokenAccount(
      ctx.conn,
      ctx.payer,
      otherMint,
      recipient.publicKey,
    );

    const e = await expectFailure(
      redeemIx({
        slot: note.slot,
        vault: note.vault,
        amount: usdc(1),
        mint: otherMint,
        ownerAta: otherOwnerAta,
        recipientAta: otherRecipientAta,
      }),
    );
    assert.isNotNull(e, 'the banknote paid out in a different token');
    assert.equal(anchorErrorCode(e), 'WrongMint', e.message);
  });

  /**
   * The vault is a PDA of the slot, so swapping in another banknote's vault is the
   * obvious way to try to spend collateral that isn't backing this voucher.
   */
  it('REJECTS a vault belonging to a different banknote', async () => {
    const note = await ctx.openSlot(usdc(10));
    const other = await ctx.openSlot(usdc(50));

    const e = await expectFailure(
      redeemIx({ slot: note.slot, vault: other.vault, amount: usdc(10) }),
    );
    assert.isNotNull(e, "another banknote's vault was drained");
    assert.match(e.message ?? String(e), /ConstraintSeeds|2006/i, e.message);
  });
});
