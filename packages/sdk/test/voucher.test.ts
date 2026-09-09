import { Keypair, PublicKey } from '@solana/web3.js';
import { buildVoucher, verifyVoucher } from '../src/voucher';
import { CachedSlot, VoucherError } from '../src/types';
import { slotPda } from '../src/pdas';

const owner = Keypair.generate();
const deviceKey = Keypair.generate();
const recipient = Keypair.generate();
const attacker = Keypair.generate();
const nonceAccount = Keypair.generate();
const mint = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// Un nonce value es un blockhash (32 bytes base58). Simulamos uno.
const fakeNonceValue = Keypair.generate().publicKey.toBase58();

const slot: CachedSlot = {
  index: 3,
  owner: owner.publicKey.toBase58(),
  authorizedSigner: deviceKey.publicKey.toBase58(),
  nonceAccount: nonceAccount.publicKey.toBase58(),
  nonceValue: fakeNonceValue,
  mint: mint.toBase58(),
  amount: '20000000', // 20 USDC
  syncedAt: new Date().toISOString(),
  status: 'available',
};

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e: any) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}

console.log('\nNoncePayment — round-trip de voucher offline\n');

const envelope = buildVoucher({
  slot, deviceKey, recipient: recipient.publicKey,
  amount: 20_000_000n, payerDomain: 'david.skr',
});

check('el voucher se construye sin red', () => {
  if (!envelope.tx) throw new Error('sin tx');
});

check('cabe en un QR (< 2300 bytes)', () => {
  const bytes = Buffer.from(envelope.tx, 'base64').length;
  console.log(`        tx=${bytes}B  base64=${envelope.tx.length}B`);
  if (envelope.tx.length > 2300) throw new Error('demasiado grande para QR');
});

check('el receptor lo verifica offline', () => {
  const v = verifyVoucher(envelope, recipient.publicKey);
  if (v.amount !== 20_000_000n) throw new Error(`importe ${v.amount}`);
  if (!v.payer.equals(owner.publicKey)) throw new Error('payer incorrecto');
  if (!v.nonceAccount.equals(nonceAccount.publicKey)) throw new Error('nonce incorrecto');
  const [expected] = slotPda(owner.publicKey, 3);
  if (!v.slot.equals(expected)) throw new Error('slot PDA incorrecto');
});

check('RECHAZA si el destinatario no soy yo', () => {
  try { verifyVoucher(envelope, attacker.publicKey); }
  catch (e) { if ((e as VoucherError).code === 'WRONG_RECIPIENT') return; throw e; }
  throw new Error('deberia haber fallado');
});

check('RECHAZA si manipulan el importe en el hint', () => {
  const tampered = { ...envelope, hint: { ...envelope.hint, amount: '999000000' } };
  try { verifyVoucher(tampered, recipient.publicKey); }
  catch (e) { if ((e as VoucherError).code === 'HINT_MISMATCH') return; throw e; }
  throw new Error('deberia haber fallado');
});

check('RECHAZA si manipulan los bytes de la transaccion', () => {
  const raw = Buffer.from(envelope.tx, 'base64');
  raw[raw.length - 5] ^= 0xff; // tocar el importe dentro de la ix redeem
  const tampered = { ...envelope, tx: raw.toString('base64') };
  try { verifyVoucher(tampered, recipient.publicKey); }
  catch (e) {
    const c = (e as VoucherError).code;
    if (c === 'BAD_SIGNATURE' || c === 'HINT_MISMATCH' || c === 'MALFORMED') return;
    throw e;
  }
  throw new Error('deberia haber fallado');
});

check('RECHAZA firmar por encima del valor del billete', () => {
  try { buildVoucher({ slot, deviceKey, recipient: recipient.publicKey, amount: 999_000_000n }); }
  catch (e) { if ((e as VoucherError).code === 'MALFORMED') return; throw e; }
  throw new Error('deberia haber fallado');
});

check('RECHAZA una clave de dispositivo que no es la autorizada', () => {
  try { buildVoucher({ slot, deviceKey: attacker, recipient: recipient.publicKey, amount: 1_000_000n }); }
  catch (e) { if ((e as VoucherError).code === 'MISSING_SIGNATURE') return; throw e; }
  throw new Error('deberia haber fallado');
});

check('pago parcial: 5 de un billete de 20, cambio implicito', () => {
  const partial = buildVoucher({ slot, deviceKey, recipient: recipient.publicKey, amount: 5_000_000n });
  const v = verifyVoucher(partial, recipient.publicKey);
  if (v.amount !== 5_000_000n) throw new Error('importe incorrecto');
});

console.log(`\n  ${pass} pasan, ${fail} fallan\n`);
process.exit(fail === 0 ? 0 : 1);
