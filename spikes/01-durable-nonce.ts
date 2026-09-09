/**
 * SPIKE 01 — ¿sobrevive una transacción con durable nonce al paso del tiempo?
 *
 * Es LA pregunta del proyecto. Si la respuesta es no, NoncePayment no existe.
 *
 *   npx tsx 01-durable-nonce.ts create   # crea el nonce y firma una tx; la guarda
 *   npx tsx 01-durable-nonce.ts send     # envíala DESPUÉS de >10 minutos
 *   npx tsx 01-durable-nonce.ts double   # demuestra que el doble gasto falla
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const RPC = 'https://api.devnet.solana.com';
const STATE = path.join(__dirname, '.spike-state.json');

function loadPayer(): Keypair {
  const p = path.join(os.homedir(), '.config/solana/id.json');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

async function create() {
  const conn = new Connection(RPC, 'confirmed');
  const payer = loadPayer();
  const recipient = Keypair.generate();

  const balance = await conn.getBalance(payer.publicKey);
  console.log(`Pagador: ${payer.publicKey.toBase58()}  (${balance / LAMPORTS_PER_SOL} SOL)`);
  if (balance < 0.05 * LAMPORTS_PER_SOL) throw new Error('Saldo bajo. Haz airdrop.');

  // --- 1. Crear el nonce account
  const nonceKp = Keypair.generate();
  const rent = await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);

  const createTx = new Transaction().add(
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
  await sendAndConfirmTransaction(conn, createTx, [payer, nonceKp]);
  console.log(`Nonce account creado: ${nonceKp.publicKey.toBase58()}  (renta ${rent / LAMPORTS_PER_SOL} SOL)`);

  // --- 2. Leer el valor almacenado del nonce
  const info = await conn.getAccountInfo(nonceKp.publicKey);
  const nonceValue = NonceAccount.fromAccountData(info!.data).nonce;
  console.log(`Valor del nonce: ${nonceValue}`);

  // --- 3. Firmar una transacción que NO caduca
  const tx = new Transaction().add(
    SystemProgram.nonceAdvance({
      noncePubkey: nonceKp.publicKey,
      authorizedPubkey: payer.publicKey,
    }),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 1_000_000,
    }),
  );
  tx.recentBlockhash = nonceValue;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  fs.writeFileSync(
    STATE,
    JSON.stringify({
      nonceAccount: nonceKp.publicKey.toBase58(),
      nonceValue,
      recipient: recipient.publicKey.toBase58(),
      signedTx: tx.serialize().toString('base64'),
      signedAt: new Date().toISOString(),
    }),
  );

  console.log(`\nTransacción firmada y guardada (${tx.serialize().length} bytes).`);
  console.log('AHORA ESPERA MÁS DE 10 MINUTOS y ejecuta:  npx tsx 01-durable-nonce.ts send');
}

async function send() {
  const conn = new Connection(RPC, 'confirmed');
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));

  const minutes = (Date.now() - new Date(state.signedAt).getTime()) / 60000;
  console.log(`Firmada hace ${minutes.toFixed(1)} minutos.`);
  if (minutes < 10) console.log('⚠️  Menos de 10 min: la prueba no demuestra gran cosa todavía.');

  const sig = await conn.sendRawTransaction(Buffer.from(state.signedTx, 'base64'));
  await conn.confirmTransaction(sig, 'confirmed');

  console.log(`\n✅ CONFIRMADA tras ${minutes.toFixed(1)} minutos.`);
  console.log(`https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log('\nUna transacción normal habría caducado a los ~60 segundos.');
}

async function double() {
  const conn = new Connection(RPC, 'confirmed');
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));

  console.log('Reenviando la MISMA transacción (simula un doble gasto)...\n');
  try {
    const sig = await conn.sendRawTransaction(Buffer.from(state.signedTx, 'base64'), {
      skipPreflight: false,
    });
    console.log(`❌ MAL: se aceptó ${sig}. Revisa el planteamiento.`);
  } catch (e: any) {
    console.log('✅ RECHAZADA, como debe ser:');
    console.log(`   ${e.message.split('\n')[0]}`);
    console.log('\nEl nonce ya se avanzó, así que el blockhash almacenado cambió.');
    console.log('ESTA es la garantía anti-doble-gasto de NoncePayment.');
  }
}

const cmd = process.argv[2] ?? 'create';
({ create, send, double }[cmd] ?? create)().catch((e) => {
  console.error(e);
  process.exit(1);
});
