/**
 * Roadmap day 9 — proof that the deployed program actually works.
 *
 * Deploying and working are different claims. This runs the whole loop against the
 * program on devnet, with the real SDK: load a banknote, sign a voucher with no
 * network, cash it, and fail to cash it twice.
 *
 * It uses its own test mint rather than devnet USDC, so it needs no faucet beyond SOL.
 * Costs about 0.012 SOL, most of it recoverable rent.
 *
 *   npx tsx scripts/devnet-smoke.ts
 */
import * as anchor from '@coral-xyz/anchor';
import {
  Keypair,
  LAMPORTS_PER_SOL,
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
  getAssociatedTokenAddressSync,
  mintTo,
} from '@solana/spl-token';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CachedSlot,
  buildVoucher,
  readNonceValue,
  verifyVoucher,
} from '../../packages/sdk/src';
import idl from '../target/idl/nonce_payment.json';
import { NoncePayment } from '../target/types/nonce_payment';

const RPC = process.env.RPC ?? 'https://api.devnet.solana.com';
const DECIMALS = 6;
const usdc = (n: number) => BigInt(Math.round(n * 10 ** DECIMALS));

function loadWallet(): Keypair {
  const p = path.join(os.homedir(), '.config/solana/id.json');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

function link(sig: string) {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

(async () => {
  const owner = loadWallet();
  const conn = new anchor.web3.Connection(RPC, 'confirmed');
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(owner), {
    commitment: 'confirmed',
  });
  const program = new anchor.Program(idl as NoncePayment, provider);

  console.log(`Program:  ${program.programId.toBase58()}`);
  console.log(`Owner:    ${owner.publicKey.toBase58()}`);
  const start = await conn.getBalance(owner.publicKey);
  console.log(`Balance:  ${start / LAMPORTS_PER_SOL} SOL\n`);

  // --- Setup: a test token and a device key with SOL for fees. ---------------
  const deviceKey = Keypair.generate();
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: deviceKey.publicKey,
        lamports: 0.02 * LAMPORTS_PER_SOL,
      }),
    ),
    [owner],
  );
  const mint = await createMint(conn, owner, owner.publicKey, null, DECIMALS);
  const ownerAta = await createAssociatedTokenAccount(conn, owner, mint, owner.publicKey);
  await mintTo(conn, owner, mint, ownerAta, owner, Number(usdc(100)));
  console.log(`Test mint: ${mint.toBase58()}`);

  // --- 1. ONLINE: load a banknote. ------------------------------------------
  const index = Math.floor(Math.random() * 60000);
  const indexLe = Buffer.alloc(2);
  indexLe.writeUInt16LE(index);
  const [slot] = PublicKey.findProgramAddressSync(
    [Buffer.from('slot'), owner.publicKey.toBuffer(), indexLe],
    program.programId,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), slot.toBuffer()],
    program.programId,
  );

  const nonceKp = Keypair.generate();
  const nonceRent = await conn.getMinimumBalanceForRentExemption(80);
  await sendAndConfirmTransaction(
    conn,
    SystemProgram.createNonceAccount({
      fromPubkey: owner.publicKey,
      noncePubkey: nonceKp.publicKey,
      authorizedPubkey: deviceKey.publicKey,
      lamports: nonceRent,
    }),
    [owner, nonceKp],
  );

  const openSig = await program.methods
    .openSlot(index, new anchor.BN(usdc(5).toString()))
    .accountsPartial({
      owner: owner.publicKey,
      authorizedSigner: deviceKey.publicKey,
      slot,
      vault,
      mint,
      ownerAta,
      nonceAccount: nonceKp.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log(`\n[1/4] Banknote of 5 loaded.  ${link(openSig)}`);

  // The phone caches this much, and nothing else.
  const cached: CachedSlot = {
    index,
    owner: owner.publicKey.toBase58(),
    authorizedSigner: deviceKey.publicKey.toBase58(),
    nonceAccount: nonceKp.publicKey.toBase58(),
    nonceValue: await readNonceValue(conn, nonceKp.publicKey),
    mint: mint.toBase58(),
    amount: usdc(5).toString(),
    syncedAt: new Date().toISOString(),
    status: 'available',
  };

  // --- 2. OFFLINE: build two vouchers from the same banknote. ---------------
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const toAlice = buildVoucher({
    slot: cached,
    deviceKey,
    recipient: alice.publicKey,
    amount: usdc(5),
  });
  const toBob = buildVoucher({
    slot: cached,
    deviceKey,
    recipient: bob.publicKey,
    amount: usdc(5),
  });

  // Both verify with no network. Neither recipient can tell there is a problem.
  verifyVoucher(toAlice, alice.publicKey);
  verifyVoucher(toBob, bob.publicKey);
  console.log(`[2/4] Two vouchers signed offline, ${toAlice.tx.length} B each. Both verify.`);

  // --- 3. ONLINE again: whoever gets there first wins. ----------------------
  const paySig = await conn.sendRawTransaction(Buffer.from(toAlice.tx, 'base64'));
  await conn.confirmTransaction(paySig, 'confirmed');
  const aliceAta = getAssociatedTokenAddressSync(mint, alice.publicKey);
  const paid = (await getAccount(conn, aliceAta)).amount;
  console.log(`[3/4] Alice collected ${Number(paid) / 10 ** DECIMALS}.  ${link(paySig)}`);

  // --- 4. And the second voucher is dead. -----------------------------------
  try {
    await conn.sendRawTransaction(Buffer.from(toBob.tx, 'base64'), { skipPreflight: false });
    console.log('[4/4] ❌ WRONG: the same banknote was cashed twice.');
    process.exitCode = 1;
  } catch (e: any) {
    const msg = String(e.message ?? e).replace(/\s+/g, ' ');
    const byNonce = /Blockhash not found/i.test(msg);
    console.log(`[4/4] ${byNonce ? '✅' : '❌'} Bob's voucher rejected: ${byNonce ? 'Blockhash not found' : msg}`);
    if (!byNonce) process.exitCode = 1;
  }

  const spent = (start - (await conn.getBalance(owner.publicKey))) / LAMPORTS_PER_SOL;
  console.log(`\nSpent: ${spent.toFixed(6)} SOL`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
