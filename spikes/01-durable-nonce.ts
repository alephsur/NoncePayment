/**
 * SPIKE 01 — does a durable-nonce transaction survive the passage of time?
 *
 * THE question of the project. If the answer is no, NoncePayment doesn't exist.
 *
 * Two ways to run it:
 *
 *   # A) Full automated proof (localnet: slots move fast, ~2 min)
 *   solana-test-validator --reset --quiet &
 *   RPC=http://127.0.0.1:8899 npx tsx 01-durable-nonce.ts all
 *
 *   # B) The slow, real proof (devnet: you actually have to wait)
 *   npx tsx 01-durable-nonce.ts create   # creates the nonce, signs a tx, saves it
 *   npx tsx 01-durable-nonce.ts send     # send it AFTER >10 minutes
 *   npx tsx 01-durable-nonce.ts double   # shows the double spend failing
 *
 * What you have to watch with your own eyes:
 *   1. The control tx (normal blockhash) EXPIRES.
 *   2. The durable-nonce tx, signed at the same instant, CONFIRMS.
 *   3. A second tx signed against the SAME nonce value is REJECTED.
 * Point 3 is the anti-double-spend guarantee of the entire product.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const RPC = process.env.RPC ?? 'https://api.devnet.solana.com';
const STATE = path.join(__dirname, '.spike-state.json');
const isLocal = RPC.includes('127.0.0.1') || RPC.includes('localhost');

function conn() {
  return new Connection(RPC, 'confirmed');
}

function loadPayer(): Keypair {
  const p = path.join(os.homedir(), '.config/solana/id.json');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

/** On localnet we fund ourselves; on devnet the faucet is usually rate-limited. */
async function ensureFunds(c: Connection, payer: Keypair) {
  let balance = await c.getBalance(payer.publicKey);
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    if (!isLocal) {
      throw new Error(
        `Low balance (${balance / LAMPORTS_PER_SOL} SOL) on ${payer.publicKey.toBase58()}.\n` +
          'Fund it: solana airdrop 2 --url devnet  (or https://faucet.solana.com)',
      );
    }
    const sig = await c.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await c.confirmTransaction(sig, 'confirmed');
    balance = await c.getBalance(payer.publicKey);
  }
  console.log(`Payer: ${payer.publicKey.toBase58()}  (${balance / LAMPORTS_PER_SOL} SOL)`);
}

/** Creates the nonce account and returns its keypair and the stored value. */
async function createNonce(c: Connection, payer: Keypair) {
  const nonceKp = Keypair.generate();
  const rent = await c.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: nonceKp.publicKey,
      lamports: rent,
      space: NONCE_ACCOUNT_LENGTH,
      programId: SystemProgram.programId,
    }),
    SystemProgram.nonceInitialize({
      noncePubkey: nonceKp.publicKey,
      authorizedPubkey: payer.publicKey,
    }),
  );
  await sendAndConfirmTransaction(c, tx, [payer, nonceKp]);

  const info = await c.getAccountInfo(nonceKp.publicKey);
  const nonceValue = NonceAccount.fromAccountData(info!.data).nonce;

  console.log(`Nonce account: ${nonceKp.publicKey.toBase58()}  (rent ${rent / LAMPORTS_PER_SOL} SOL)`);
  console.log(`Nonce value: ${nonceValue}`);
  return { nonceKp, nonceValue, rent };
}

/**
 * Signs a tx that spends the nonce: `nonceAdvance` is ALWAYS the first instruction.
 * That advance is what invalidates any other tx signed against the same value.
 */
function signDurableTx(
  payer: Keypair,
  noncePubkey: import('@solana/web3.js').PublicKey,
  nonceValue: string,
  toPubkey: import('@solana/web3.js').PublicKey,
  lamports: number,
) {
  const tx = new Transaction().add(
    SystemProgram.nonceAdvance({ noncePubkey, authorizedPubkey: payer.publicKey }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey, lamports }),
  );
  tx.recentBlockhash = nonceValue;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  return tx;
}

// ---------------------------------------------------------------- commands

async function create() {
  const c = conn();
  const payer = loadPayer();
  await ensureFunds(c, payer);

  const { nonceKp, nonceValue } = await createNonce(c, payer);
  const recipient = Keypair.generate();
  const tx = signDurableTx(payer, nonceKp.publicKey, nonceValue, recipient.publicKey, 1_000_000);

  fs.writeFileSync(
    STATE,
    JSON.stringify(
      {
        rpc: RPC,
        nonceAccount: nonceKp.publicKey.toBase58(),
        nonceValue,
        recipient: recipient.publicKey.toBase58(),
        signedTx: tx.serialize().toString('base64'),
        signedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`\nTransaction signed and saved (${tx.serialize().length} bytes).`);
  console.log('NOW WAIT MORE THAN 10 MINUTES and run:  npx tsx 01-durable-nonce.ts send');
}

async function send() {
  const c = conn();
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));

  const minutes = (Date.now() - new Date(state.signedAt).getTime()) / 60000;
  console.log(`Signed ${minutes.toFixed(1)} minutes ago.`);
  if (minutes < 10) console.log('⚠️  Under 10 min: the proof does not show much yet.');

  const sig = await c.sendRawTransaction(Buffer.from(state.signedTx, 'base64'));
  await c.confirmTransaction(sig, 'confirmed');

  console.log(`\n✅ CONFIRMED after ${minutes.toFixed(1)} minutes.`);
  console.log(`https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log('\nA normal transaction would have expired after ~60 seconds.');
}

/**
 * The real double spend: signing a DIFFERENT tx against the same nonce value.
 * (Resending the same tx would prove nothing: it could fail on deduplication alone.)
 */
async function double() {
  const c = conn();
  const payer = loadPayer();
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));

  const other = Keypair.generate();
  const tx = signDurableTx(
    payer,
    new (require('@solana/web3.js').PublicKey)(state.nonceAccount),
    state.nonceValue,
    other.publicKey,
    2_000_000, // different amount, different recipient: it is another tx
  );

  console.log('Sending a SECOND transaction signed against the same nonce...\n');
  try {
    const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    console.log(`❌ WRONG: it was accepted, ${sig}. Rethink the approach.`);
    process.exitCode = 1;
  } catch (e: any) {
    console.log('✅ REJECTED, as it should be:');
    console.log(`   ${reason(e)}`);
    console.log('\nThe nonce already advanced, so the stored value changed.');
    console.log('THIS is the anti-double-spend guarantee of NoncePayment.');
  }
}

/** The reason for the rejection is in the body of the error, not its first line. */
function reason(e: any): string {
  const msg = String(e?.message ?? e).replace(/\s+/g, ' ').trim();
  const logs: string[] = e?.logs ?? [];
  return logs.length ? `${msg}\n   logs: ${logs.join(' | ')}` : msg;
}

/** Waits for a normal blockhash to expire, by polling the chain. */
async function waitForExpiry(c: Connection, blockhash: string) {
  const t0 = Date.now();
  for (;;) {
    const { value: valid } = await c.isBlockhashValid(blockhash, { commitment: 'confirmed' });
    const s = ((Date.now() - t0) / 1000).toFixed(0);
    if (!valid) {
      console.log(`   control blockhash EXPIRED after ${s}s`);
      return Number(s);
    }
    process.stdout.write(`\r   waiting for the control blockhash to expire... ${s}s`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** Full hands-off proof: control expires, durable survives, double spend fails. */
async function all() {
  const c = conn();
  const payer = loadPayer();
  console.log(`RPC: ${RPC}\n`);
  await ensureFunds(c, payer);

  const { nonceKp, nonceValue } = await createNonce(c, payer);

  // --- Two transactions signed AT THE SAME INSTANT, one of each kind.
  const recipient = Keypair.generate();
  const durable = signDurableTx(payer, nonceKp.publicKey, nonceValue, recipient.publicKey, 1_000_000);

  const { blockhash } = await c.getLatestBlockhash('confirmed');
  const control = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 1_000_000,
    }),
  );
  control.recentBlockhash = blockhash;
  control.feePayer = payer.publicKey;
  control.sign(payer);

  fs.writeFileSync(
    STATE,
    JSON.stringify(
      {
        rpc: RPC,
        nonceAccount: nonceKp.publicKey.toBase58(),
        nonceValue,
        recipient: recipient.publicKey.toBase58(),
        signedTx: durable.serialize().toString('base64'),
        signedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`\nTwo txs signed just now: control (blockhash ${blockhash.slice(0, 8)}…) and durable.\n`);

  // --- 1. Wait until the normal blockhash has genuinely expired.
  const secs = await waitForExpiry(c, blockhash);

  // --- 2. The control one has to fail.
  console.log('\n[1/3] Sending the CONTROL tx (normal blockhash, expired)...');
  try {
    const sig = await c.sendRawTransaction(control.serialize(), { skipPreflight: false });
    console.log(`   ❌ WRONG: accepted as ${sig}. The blockhash had not really expired.`);
    process.exitCode = 1;
  } catch (e: any) {
    console.log(`   ✅ REJECTED: ${reason(e)}`);
  }

  // --- 3. The durable one, signed at the same moment, has to confirm.
  console.log('\n[2/3] Sending the DURABLE tx (signed at the same instant)...');
  const sig = await c.sendRawTransaction(durable.serialize());
  await c.confirmTransaction(sig, 'confirmed');
  console.log(`   ✅ CONFIRMED after ${secs}s: ${sig}`);

  // --- 4. And the double spend against the same nonce, to fail.
  console.log('\n[3/3] Double spend: another tx against the SAME nonce value...');
  await double();

  const info = await c.getAccountInfo(nonceKp.publicKey);
  const after = NonceAccount.fromAccountData(info!.data).nonce;
  console.log(`\nNonce value: ${nonceValue}\n         →   ${after}`);
  console.log('The banknote is spent. There is no way to collect it twice.');
}

const cmd = process.argv[2] ?? 'create';
const cmds: Record<string, () => Promise<void>> = { create, send, double, all };
(cmds[cmd] ?? create)().catch((e) => {
  console.error(e);
  process.exit(1);
});
