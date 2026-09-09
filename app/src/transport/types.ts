/**
 * Abstraccion de transporte.
 *
 * Tres capas, deliberadamente. La estrategia esta explicada en docs/REFERENCE.md §5:
 * el NFC es el momento "wow" del video pero es lo mas fragil, asi que NO lleva el
 * voucher — lleva solo un handshake de 32 bytes. El BLE hace el intercambio real y el
 * QR es el fallback que nunca falla.
 *
 * Si el spike del dia 4 dice que HCE no tira, se borra nfc.ts y el resto sigue igual.
 * Esa es toda la razon de ser de esta interfaz.
 */
export type TransportId = 'nfc' | 'ble' | 'qr';

export interface TransportCapability {
  id: TransportId;
  label: string;
  available: boolean;
  reason?: string;
  /** Bytes maximos que puede mover comodamente. */
  maxPayload: number;
}

export interface Transport {
  readonly id: TransportId;
  readonly label: string;
  /** Payload maximo comodo, en bytes. */
  readonly maxPayload: number;

  isAvailable(): Promise<{ available: boolean; reason?: string }>;

  /** Lado pagador: publica el payload y resuelve cuando el receptor lo tiene. */
  send(payload: Uint8Array, signal?: AbortSignal): Promise<void>;

  /** Lado receptor: espera un payload. */
  receive(signal?: AbortSignal): Promise<Uint8Array>;

  stop(): Promise<void>;
}

/**
 * Handshake que viaja por NFC. 32 bytes de id de sesion + la UUID del servicio BLE.
 *
 * El tap solo dice "soy yo, conectate a este canal". El dinero va por BLE.
 */
export interface NfcHandshake {
  sessionId: string;
  bleServiceUuid: string;
  recipient: string;
}

export const MAX_QR_BYTES = 2300;
export const MAX_NFC_BYTES = 255;
