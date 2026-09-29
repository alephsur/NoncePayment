/**
 * Liquidacion (ONLINE). Se dispara automaticamente en cuanto vuelve la conectividad.
 */
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { base58Encode } from './bytes';
import { VerificationLevel, VerifiedVoucher } from './types';

export interface SettlementResult {
  signature: string;
  level: VerificationLevel.ONCHAIN_CONFIRMED;
}

/**
 * Envia un voucher a la red.
 *
 * Como la transaccion usa un durable nonce, puede enviarse en cualquier momento —
 * minutos, horas o dias despues de haberse firmado.
 */
export async function settleVoucher(
  connection: Connection,
  voucher: VerifiedVoucher,
): Promise<SettlementResult> {
  const signature = voucherSignature(voucher.rawTransaction);
  const done = { signature, level: VerificationLevel.ONCHAIN_CONFIRMED } as const;

  // Pagador y receptor liquidan el MISMO voucher, cada uno en cuanto tiene red. El que
  // llega segundo encuentra el nonce ya avanzado — por su propio pago, no por otro — y
  // la red le contesta igual que a un doble gasto: `Blockhash not found`. La unica
  // manera de distinguirlos es preguntar si ESTA firma ya esta en cadena.
  if (await landed(connection, signature)) return done;

  try {
    await connection.sendRawTransaction(voucher.rawTransaction, {
      skipPreflight: false,
      maxRetries: 5,
    });
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      'confirmed',
    );
    return done;
  } catch (e) {
    // La otra parte pudo enviarlo un instante antes: su transaccion puede estar
    // procesada y aun no confirmada cuando la nuestra falla. Se le da unos segundos.
    if (await landed(connection, signature, LANDED_WAIT_MS)) return done;
    throw e;
  }
}

const LANDED_WAIT_MS = 8_000;

/** La firma de un voucher: la del pagador, la primera. Determinista, se sabe offline. */
export function voucherSignature(rawTransaction: Uint8Array): string {
  const sig = Transaction.from(rawTransaction).signature;
  if (!sig) throw new Error('Voucher sin firma del pagador');
  return base58Encode(sig);
}

/**
 * Si esta firma esta confirmada en cadena y sin error.
 *
 * Una transaccion con durable nonce que falla tambien avanza el nonce, asi que "esta en
 * cadena" no basta: con error, el dinero no se movio.
 */
async function landed(connection: Connection, signature: string, waitMs = 0): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (status && status.confirmationStatus !== 'processed') return status.err === null;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Comprueba si el slot de un voucher sigue vivo y con colateral.
 *
 * Es lo que sube el nivel de verificacion de CRYPTO_ONLY a algo mas fuerte en cuanto
 * el receptor pilla aunque sea un instante de red.
 */
export async function checkSlotFunded(
  connection: Connection,
  slot: PublicKey,
): Promise<{ exists: boolean; lamports: number }> {
  const info = await connection.getAccountInfo(slot, 'confirmed');
  return { exists: info !== null, lamports: info?.lamports ?? 0 };
}
