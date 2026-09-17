/**
 * Construccion y verificacion de vouchers offline.
 *
 * Un voucher es una transaccion de Solana COMPLETA y FIRMADA que no caduca (usa un
 * durable nonce). Se construye sin red, viaja por NFC/BLE/QR, y se envia a la cadena
 * cuando cualquiera de las dos partes recupera conectividad.
 */
import {
  AccountMeta,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

import { bytesEqual } from './bytes';
import { PROGRAM_ID, SYSTEM_IX_ADVANCE_NONCE } from './constants';
import { slotPda, vaultPda } from './pdas';
import {
  CachedSlot,
  VerificationLevel,
  VerifiedVoucher,
  VoucherEnvelope,
  VoucherError,
} from './types';

/** Discriminador Anchor: primeros 8 bytes de sha256("global:<nombre_instruccion>"). */
function anchorDiscriminator(name: string): Uint8Array {
  return sha256(utf8ToBytes(`global:${name}`)).slice(0, 8);
}

const REDEEM_DISCRIMINATOR = anchorDiscriminator('redeem');

/** Posiciones de cuentas en la instruccion `redeem`. Deben coincidir con el contexto Rust. */
const REDEEM_ACCOUNTS = {
  AUTHORIZED_SIGNER: 0,
  OWNER: 1,
  SLOT: 2,
  VAULT: 3,
  MINT: 4,
  RECIPIENT: 5,
  RECIPIENT_ATA: 6,
  OWNER_ATA: 7,
  TOKEN_PROGRAM: 8,
  ASSOCIATED_TOKEN_PROGRAM: 9,
} as const;

// ---------------------------------------------------------------------------
// Construccion (lado pagador, OFFLINE)
// ---------------------------------------------------------------------------

export function buildRedeemInstruction(params: {
  authorizedSigner: PublicKey;
  owner: PublicKey;
  slotIndex: number;
  mint: PublicKey;
  recipient: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const [slot] = slotPda(params.owner, params.slotIndex);
  const [vault] = vaultPda(slot);
  const recipientAta = getAssociatedTokenAddressSync(params.mint, params.recipient);
  const ownerAta = getAssociatedTokenAddressSync(params.mint, params.owner);

  const data = Buffer.alloc(16);
  Buffer.from(REDEEM_DISCRIMINATOR).copy(data, 0);
  data.writeBigUInt64LE(params.amount, 8);

  const keys: AccountMeta[] = [
    { pubkey: params.authorizedSigner, isSigner: true, isWritable: false },
    { pubkey: params.owner, isSigner: false, isWritable: true },
    { pubkey: slot, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: params.mint, isSigner: false, isWritable: false },
    { pubkey: params.recipient, isSigner: false, isWritable: false },
    { pubkey: recipientAta, isSigner: false, isWritable: true },
    { pubkey: ownerAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

/**
 * Construye y firma un voucher SIN RED.
 *
 * Estructura de la transaccion, en este orden exacto:
 *   [0] AdvanceNonceAccount  -- obligatorio que sea la primera; es lo que hace que no caduque
 *   [1] CreateIdempotentATA  -- el receptor puede no tener cuenta de USDC todavia
 *   [2] redeem               -- el pago en si
 *
 * El fee payer es la clave de dispositivo, que se prefinancia con SOL durante la carga.
 */
export function buildVoucher(params: {
  slot: CachedSlot;
  deviceKey: Keypair;
  recipient: PublicKey;
  amount: bigint;
  payerDomain?: string;
}): VoucherEnvelope {
  const { slot, deviceKey, recipient, amount } = params;

  const owner = new PublicKey(slot.owner);
  const mint = new PublicKey(slot.mint);
  const nonceAccount = new PublicKey(slot.nonceAccount);

  if (deviceKey.publicKey.toBase58() !== slot.authorizedSigner) {
    throw new VoucherError(
      'La clave de dispositivo no coincide con el firmante autorizado del billete',
      'MISSING_SIGNATURE',
    );
  }
  if (amount <= 0n || amount > BigInt(slot.amount)) {
    throw new VoucherError('Importe fuera del rango del billete', 'MALFORMED');
  }

  const tx = new Transaction();

  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: nonceAccount,
      authorizedPubkey: deviceKey.publicKey,
    }),
  );

  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      deviceKey.publicKey,
      getAssociatedTokenAddressSync(mint, recipient),
      recipient,
      mint,
    ),
  );

  tx.add(
    buildRedeemInstruction({
      authorizedSigner: deviceKey.publicKey,
      owner,
      slotIndex: slot.index,
      mint,
      recipient,
      amount,
    }),
  );

  // El valor cacheado del nonce hace las veces de recentBlockhash. Nunca caduca.
  tx.recentBlockhash = slot.nonceValue;
  tx.feePayer = deviceKey.publicKey;
  tx.sign(deviceKey);

  return {
    v: 1,
    tx: tx.serialize({ requireAllSignatures: true }).toString('base64'),
    hint: {
      payer: owner.toBase58(),
      recipient: recipient.toBase58(),
      mint: mint.toBase58(),
      amount: amount.toString(),
      slotIndex: slot.index,
      payerDomain: params.payerDomain,
    },
  };
}

// ---------------------------------------------------------------------------
// Verificacion (lado receptor, OFFLINE)
// ---------------------------------------------------------------------------

/**
 * Verifica un voucher sin red.
 *
 * Lo que SI se puede comprobar offline:
 *   - la firma ed25519 es autentica sobre el mensaje exacto
 *   - la transaccion es durable (no caduca)
 *   - llama a NUESTRO programa, instruccion `redeem`
 *   - el destinatario soy yo, y el importe es el anunciado
 *   - el firmante coincide con el firmante autorizado del slot
 *
 * Lo que NO se puede comprobar offline:
 *   - que el slot exista y tenga colateral. Ver docs/THREAT-MODEL.md.
 *
 * Por eso el nivel maximo alcanzable sin red es CRYPTO_ONLY.
 */
/**
 * Verifica contra cualquiera de las identidades que este movil controla.
 *
 * Un telefono puede cobrar a dos direcciones distintas: su clave de dispositivo, que
 * existe siempre, y la wallet del usuario cuando la tiene conectada — y esa es la que
 * se ofrece, porque el dinero aterriza donde se puede usar y no hay que traspasarlo
 * despues. Un voucher legitimo puede ir a cualquiera de las dos: a la wallet si se
 * cobro con ella conectada, a la clave si se cobro sin ella, o si venia de una version
 * anterior.
 *
 * Sigue siendo la misma comprobacion de seguridad, no una mas laxa: cada candidata es
 * una identidad de la que el usuario es dueño. Lo que NO se puede hacer es aceptar un
 * voucher dirigido a un tercero, y eso no cambia.
 */
export function verifyVoucherForAny(
  envelope: VoucherEnvelope,
  candidates: PublicKey[],
): { verified: VerifiedVoucher; matched: PublicKey } {
  if (candidates.length === 0) {
    throw new VoucherError('Este movil no tiene ninguna identidad de cobro', 'WRONG_RECIPIENT');
  }
  let last: unknown;
  for (const candidate of candidates) {
    try {
      return { verified: verifyVoucher(envelope, candidate), matched: candidate };
    } catch (e) {
      // Solo el destinatario justifica probar la siguiente. Una firma rota lo esta para
      // todas, y seguir intentando solo cambiaria el mensaje de error por uno peor.
      if (!(e instanceof VoucherError) || e.code !== 'WRONG_RECIPIENT') throw e;
      last = e;
    }
  }
  throw last;
}

export function verifyVoucher(
  envelope: VoucherEnvelope,
  expectedRecipient: PublicKey,
): VerifiedVoucher {
  if (envelope?.v !== 1 || typeof envelope.tx !== 'string') {
    throw new VoucherError('Sobre de voucher malformado', 'MALFORMED');
  }

  const raw = Buffer.from(envelope.tx, 'base64');

  let tx: Transaction;
  try {
    tx = Transaction.from(raw);
  } catch {
    throw new VoucherError('No se pudo deserializar la transaccion', 'MALFORMED');
  }

  if (tx.instructions.length !== 3) {
    throw new VoucherError(
      `Se esperaban 3 instrucciones, hay ${tx.instructions.length}`,
      'MALFORMED',
    );
  }

  // --- 1. Debe ser durable: AdvanceNonceAccount tiene que ir la primera.
  const advance = tx.instructions[0];
  if (
    !advance.programId.equals(SystemProgram.programId) ||
    advance.data.length < 4 ||
    advance.data.readUInt32LE(0) !== SYSTEM_IX_ADVANCE_NONCE
  ) {
    throw new VoucherError(
      'La transaccion no es durable: falta AdvanceNonceAccount como primera instruccion',
      'NOT_DURABLE',
    );
  }
  const nonceAccount = advance.keys[0].pubkey;

  // --- 2. La ultima instruccion tiene que ser nuestro `redeem`.
  const redeem = tx.instructions[2];
  if (!redeem.programId.equals(PROGRAM_ID)) {
    throw new VoucherError(
      `Programa inesperado: ${redeem.programId.toBase58()}`,
      'WRONG_PROGRAM',
    );
  }
  if (redeem.data.length !== 16) {
    throw new VoucherError('Longitud de datos de redeem invalida', 'WRONG_INSTRUCTION');
  }
  if (!bytesEqual(redeem.data.subarray(0, 8), REDEEM_DISCRIMINATOR)) {
    throw new VoucherError('La instruccion no es `redeem`', 'WRONG_INSTRUCTION');
  }

  const amount = redeem.data.readBigUInt64LE(8);
  const authorizedSigner = redeem.keys[REDEEM_ACCOUNTS.AUTHORIZED_SIGNER].pubkey;
  const payer = redeem.keys[REDEEM_ACCOUNTS.OWNER].pubkey;
  const slot = redeem.keys[REDEEM_ACCOUNTS.SLOT].pubkey;
  const mint = redeem.keys[REDEEM_ACCOUNTS.MINT].pubkey;
  const recipient = redeem.keys[REDEEM_ACCOUNTS.RECIPIENT].pubkey;

  // --- 3. El dinero tiene que venir a mi.
  if (!recipient.equals(expectedRecipient)) {
    throw new VoucherError(
      `El voucher va dirigido a ${recipient.toBase58()}, no a mi`,
      'WRONG_RECIPIENT',
    );
  }

  // --- 4. El PDA del slot tiene que derivar del owner declarado. Impide sustituirlo.
  const [expectedSlot] = slotPda(payer, envelope.hint.slotIndex);
  if (!expectedSlot.equals(slot)) {
    throw new VoucherError(
      'El PDA del slot no deriva del owner declarado',
      'HINT_MISMATCH',
    );
  }

  // --- 5. Firma ed25519 valida sobre el mensaje exacto.
  const message = tx.serializeMessage();
  const sigEntry = tx.signatures.find((s) =>
    s.publicKey.equals(authorizedSigner),
  );
  if (!sigEntry?.signature) {
    throw new VoucherError(
      'Falta la firma del firmante autorizado',
      'MISSING_SIGNATURE',
    );
  }
  const ok = ed25519.verify(
    new Uint8Array(sigEntry.signature),
    new Uint8Array(message),
    authorizedSigner.toBytes(),
  );
  if (!ok) {
    throw new VoucherError('Firma invalida', 'BAD_SIGNATURE');
  }

  // --- 6. El hint es solo cosmetico: si miente, se rechaza el voucher entero.
  const h = envelope.hint;
  if (
    h.payer !== payer.toBase58() ||
    h.recipient !== recipient.toBase58() ||
    h.mint !== mint.toBase58() ||
    h.amount !== amount.toString()
  ) {
    throw new VoucherError(
      'Los metadatos no coinciden con la transaccion firmada',
      'HINT_MISMATCH',
    );
  }

  return {
    level: VerificationLevel.CRYPTO_ONLY,
    payer,
    authorizedSigner,
    recipient,
    mint,
    nonceAccount,
    slot,
    amount,
    rawTransaction: new Uint8Array(raw),
  };
}
