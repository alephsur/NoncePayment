/**
 * Abstraccion de transporte.
 *
 * El diseño original daba por hecho que el NFC solo podia llevar un handshake y que el
 * dinero tendria que ir por BLE. **El spike 03 lo desmintio**: un voucher entero de
 * 1055 B cruzo 11 veces de 11 entre dos moviles reales, en las dos direcciones. Asi que
 * el NFC lleva el pago, el BLE queda fuera del camino critico y el QR sigue siendo el
 * fallback que nunca falla. Ver docs/SPIKE-RESULTS.md, spike 03.
 *
 * La interfaz existe para poder perder una capa sin que se caiga nada. Eso no ha
 * cambiado: sigue siendo lo que permitio que el BLE se bajara del plan sin tocar nada.
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
 * Handshake que viaja por NFC cuando el transporte real es el BLE.
 *
 * Solo lo usa la ruta BLE, que esta fuera del camino critico desde el spike 03. Un pago
 * por NFC no pasa por aqui: manda el voucher entero.
 */
export interface NfcHandshake {
  sessionId: string;
  bleServiceUuid: string;
  recipient: string;
}

export const MAX_QR_BYTES = 2300;

/**
 * Presupuesto de un tap.
 *
 * Eran 255 B, el tamaño del handshake que el diseño anterior daba por unico posible por
 * NFC, y eso rechazaba un voucher (1055 B medidos) antes siquiera de encender la antena.
 * El spike 03 movio ese voucher 11 veces de 11 con un presupuesto de 4096 B; 2048 deja
 * holgura sin afirmar mas de lo que se probo. Por encima de esto, medir otra vez.
 */
export const MAX_NFC_BYTES = 2048;
