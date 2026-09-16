/**
 * Roadmap day 12 — the load path the app uses, proven on devnet without a phone.
 *
 * The app loads banknotes through Mobile Wallet Adapter, which cannot be scripted. But
 * MWA only adds the owner's signature: everything else — free indexes, packing notes
 * into transactions, nonce keypairs signing first, the device-key top-up, reading the
 * banknotes back from chain — is SDK code, and this runs exactly that code with a local
 * keypair standing in for the wallet.
 *
 * The step that matters is the last one. A banknote is only as good as the nonce value
 * the phone caches, so a voucher is signed against the value fetchOwnerSlots() read
 * back and cashed on chain. If the sync had cached anything wrong, it would not land.
 *
 * A fresh owner is used on every run so the index scan starts from an empty slate. It
 * uses its own test mint, so it needs no faucet beyond SOL. Takes about 0.05 SOL from
 * the CLI wallet, most of it left behind in the throwaway owner.
 *
 *   npx tsx scripts/devnet-load.ts
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from '@solana/spl-token';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CachedSlot,
  DEVICE_KEY_FUNDING_LAMPORTS,
  NOTES_PER_TRANSACTION,
  buildLoadTransactions,
  buildVoucher,
  deviceKeyTopUpLamports,
  fetchOwnerSlots,
  findFreeSlotIndexes,
  nonceRentLamports,
  verifyVoucher,
} from '../../packages/sdk/src';

const RPC = process.env.RPC ?? 'https://api.devnet.solana.com';
const DECIMALS = 6;
const usdc = (n: number) => BigInt(Math.round(n * 10 ** DECIMALS));
const link = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

function loadWallet(): Keypair {
  const p = path.join(os.homedir(), '.config/solana/id.json');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

function check(ok: boolean, what: string) {
  console.log(`      ${ok ? '✅' : '❌'} ${what}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  const conn = new Connection(RPC, 'confirmed');
  const funder = loadWallet();
  const owner = Keypair.generate();
  const deviceKey = Keypair.generate();
  const start = await conn.getBalance(funder.publicKey);

  // --- Setup: an owner with SOL and test USDC, as the wallet would be. -------
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: owner.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      }),
    ),
    [funder],
  );
  const mint = await createMint(conn, owner, owner.publicKey, null, DECIMALS);
  const ownerAta = await createAssociatedTokenAccount(conn, owner, mint, owner.publicKey);
  await mintTo(conn, owner, mint, ownerAta, owner, Number(usdc(100)));
  console.log(`Owner:      ${owner.publicKey.toBase58()}`);
  console.log(`Device key: ${deviceKey.publicKey.toBase58()}`);
  console.log(`Test mint:  ${mint.toBase58()}\n`);

  // --- 1. Plan: three notes, so the packing has to split across transactions. --
  const amounts = [usdc(1), usdc(5), usdc(20)];
  const indexes = await findFreeSlotIndexes(conn, owner.publicKey, amounts.length);
  const topUp = await deviceKeyTopUpLamports(conn, deviceKey.publicKey);
  console.log(`[1/4] Free indexes ${indexes.join(', ')} · device key top-up ${topUp / LAMPORTS_PER_SOL} SOL`);
  check(indexes.join() === '0,1,2', 'a fresh owner gets the lowest indexes');
  check(topUp === DEVICE_KEY_FUNDING_LAMPORTS, 'an empty device key is topped up to the full target');

  // --- 2. Build exactly as the app does, sign as the wallet would, send. ------
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const { transactions } = buildLoadTransactions({
    owner: owner.publicKey,
    authorizedSigner: deviceKey.publicKey,
    mint,
    notes: amounts.map((amount, i) => ({ index: indexes[i], amount })),
    recentBlockhash: blockhash,
    nonceRentLamports: await nonceRentLamports(conn),
    deviceKeyTopUpLamports: topUp,
  });
  check(
    transactions.length === Math.ceil(amounts.length / NOTES_PER_TRANSACTION),
    `${amounts.length} notes packed into ${transactions.length} transactions`,
  );

  const sizes: number[] = [];
  for (const tx of transactions) {
    tx.partialSign(owner); // ← the only thing MWA does
    const raw = tx.serialize();
    sizes.push(raw.length);
    const sig = await conn.sendRawTransaction(raw);
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log(`[2/4] Loaded, ${raw.length} B.  ${link(sig)}`);
  }
  check(Math.max(...sizes) <= 1232, `every transaction under the 1232 B limit (${sizes.join(', ')})`);

  // --- 3. Forget everything local and read it back from chain. ----------------
  const slots = await fetchOwnerSlots(conn, owner.publicKey);
  console.log(`[3/4] Read back ${slots.length} banknotes from chain`);
  check(slots.length === amounts.length, 'all of them');
  check(
    slots.map((s) => s.amount).join() === amounts.join(),
    `amounts ${slots.map((s) => Number(s.amount) / 10 ** DECIMALS).join(', ')} in index order`,
  );
  check(slots.every((s) => s.authorizedSigner.equals(deviceKey.publicKey)), 'all name the device key');
  check(slots.every((s) => s.nonceValue !== null && s.nonceAuthorityMatches), 'all have a nonce the device key controls');
  check(
    (await conn.getBalance(deviceKey.publicKey)) === DEVICE_KEY_FUNDING_LAMPORTS,
    'the device key holds the funding target',
  );
  const next = await findFreeSlotIndexes(conn, owner.publicKey, 1);
  check(next[0] === 3, 'the next load would use index 3');

  // --- 4. The proof: a voucher against the nonce value the sync read. --------
  const s = slots[1];
  const cached: CachedSlot = {
    index: s.index,
    owner: s.owner.toBase58(),
    authorizedSigner: s.authorizedSigner.toBase58(),
    nonceAccount: s.nonceAccount.toBase58(),
    nonceValue: s.nonceValue!,
    mint: s.mint.toBase58(),
    amount: s.amount.toString(),
    syncedAt: new Date().toISOString(),
    status: 'available',
  };
  const recipient = Keypair.generate();
  const envelope = buildVoucher({ slot: cached, deviceKey, recipient: recipient.publicKey, amount: s.amount });
  const verified = verifyVoucher(envelope, recipient.publicKey);
  const paySig = await conn.sendRawTransaction(verified.rawTransaction);
  await conn.confirmTransaction(paySig, 'confirmed');
  const paid = (await getAccount(conn, getAssociatedTokenAddressSync(mint, recipient.publicKey))).amount;
  console.log(`[4/4] Voucher for the synced 5-note cashed.  ${link(paySig)}`);
  check(paid === s.amount, `recipient received ${Number(paid) / 10 ** DECIMALS}`);

  const after = await fetchOwnerSlots(conn, owner.publicKey);
  check(
    after.length === 2 && !after.some((x) => x.index === s.index),
    'the spent banknote is gone from the next sync; the other two remain',
  );

  const spent = (start - (await conn.getBalance(funder.publicKey))) / LAMPORTS_PER_SOL;
  console.log(`\nSpent: ${spent.toFixed(6)} SOL${process.exitCode ? '\n\nFAILED' : ''}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
