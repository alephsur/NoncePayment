import { PublicKey } from '@solana/web3.js';

/**
 * Un billete tal y como lo guarda el movil despues de cargarlo (online).
 *
 * `nonceValue` es el blockhash almacenado en el nonce account en el momento de la
 * carga. Es lo que permite firmar sin red: no caduca, y solo cambia cuando el nonce
 * se avanza — cosa que ocurre exactamente una vez, al canjear este billete.
 */
export interface CachedSlot {
  index: number;
  owner: string;
  authorizedSigner: string;
  nonceAccount: string;
  nonceValue: string;
  mint: string;
  /** Unidades minimas del token (6 decimales para USDC). */
  amount: string;
  /** ISO 8601. Cuando se sincronizo por ultima vez con la cadena. */
  syncedAt: string;
  status: SlotStatus;
}

export type SlotStatus =
  | 'available'
  | 'spent_pending_settlement'
  | 'settled'
  | 'reclaimed';

/**
 * Lo que viaja por NFC / BLE / QR.
 *
 * `hint` existe SOLO para pintar la UI antes de verificar. Nunca se confia en el:
 * `verifyVoucher` re-deriva todos los campos de la transaccion firmada y rechaza el
 * voucher si no coinciden.
 */
export interface VoucherEnvelope {
  v: 1;
  /** VersionedTransaction/Transaction legacy serializada y firmada, en base64. */
  tx: string;
  hint: {
    payer: string;
    recipient: string;
    mint: string;
    amount: string;
    slotIndex: number;
    /** Dominio .skr del pagador, si lo tiene. Puramente cosmetico. */
    payerDomain?: string;
  };
}

/**
 * Hasta donde ha podido llegar el receptor al validar el voucher.
 *
 * Sin red solo se puede llegar a CRYPTO_ONLY: la firma es autentica y la estructura
 * es correcta, pero la existencia del colateral no es verificable. Ver THREAT-MODEL.md.
 */
export enum VerificationLevel {
  /** Firma valida + estructura correcta. Todo lo que se puede hacer sin red. */
  CRYPTO_ONLY = 'crypto_only',
  /** Ademas, el slot estaba financiado en el ultimo snapshot cacheado. */
  CACHED_STATE = 'cached_state',
  /** La transaccion se ha confirmado en la cadena. Certeza total. */
  ONCHAIN_CONFIRMED = 'onchain_confirmed',
}

export interface VerifiedVoucher {
  level: VerificationLevel;
  payer: PublicKey;
  authorizedSigner: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  nonceAccount: PublicKey;
  slot: PublicKey;
  /** Unidades minimas. */
  amount: bigint;
  /** Bytes crudos de la transaccion, listos para enviar a la red. */
  rawTransaction: Uint8Array;
}

export class VoucherError extends Error {
  constructor(
    message: string,
    readonly code: VoucherErrorCode,
  ) {
    super(message);
    this.name = 'VoucherError';
  }
}

export type VoucherErrorCode =
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'MISSING_SIGNATURE'
  | 'NOT_DURABLE'
  | 'WRONG_PROGRAM'
  | 'WRONG_INSTRUCTION'
  | 'HINT_MISMATCH'
  | 'WRONG_RECIPIENT';
