import { Transport, TransportCapability } from './types';
import { QrTransport } from './qr';
import { BleTransport } from './ble';
import { NfcTransport } from './nfc';

export * from './types';
export { QrTransport } from './qr';
export { BleTransport, NONCEPAY_SERVICE_UUID } from './ble';
export { NfcTransport, encodeHandshake, decodeHandshake } from './nfc';

/**
 * Transportes en orden de preferencia. El QR va el ultimo a proposito: es el que
 * siempre funciona, asi que es el fallback, no la primera opcion.
 */
export function allTransports(): Transport[] {
  return [new NfcTransport(), new BleTransport(), new QrTransport()];
}

export async function probeTransports(): Promise<TransportCapability[]> {
  return Promise.all(
    allTransports().map(async (t) => {
      const { available, reason } = await t.isAvailable();
      return {
        id: t.id,
        label: t.label,
        available,
        reason,
        maxPayload: t.maxPayload,
      };
    }),
  );
}

/** Mejor transporte disponible. Nunca devuelve undefined: el QR siempre esta. */
export async function bestTransport(): Promise<Transport> {
  for (const t of allTransports()) {
    const { available } = await t.isAvailable();
    if (available) return t;
  }
  return new QrTransport();
}
