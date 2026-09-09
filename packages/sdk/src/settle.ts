/**
 * Liquidacion (ONLINE). Se dispara automaticamente en cuanto vuelve la conectividad.
 */
import { Connection, PublicKey } from '@solana/web3.js';
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
  const signature = await connection.sendRawTransaction(voucher.rawTransaction, {
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

  return { signature, level: VerificationLevel.ONCHAIN_CONFIRMED };
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
