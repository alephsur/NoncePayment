/**
 * Transporte QR. El fallback que siempre funciona.
 *
 * Un voucher pesa ~600 bytes crudos / ~800 en base64 (medido en
 * packages/sdk/test/voucher.test.ts), asi que entra sin problema en un QR nivel M.
 *
 * Nunca borres este transporte: es el plan B del video demo si el NFC o el BLE fallan
 * delante de los jueces.
 */
import { Transport, MAX_QR_BYTES } from './types';

export class QrTransport implements Transport {
  readonly id = 'qr' as const;
  readonly label = 'Codigo QR';
  readonly maxPayload = MAX_QR_BYTES;

  private pendingResolve?: (bytes: Uint8Array) => void;

  async isAvailable() {
    return { available: true };
  }

  /**
   * El QR no "envia": se pinta y el otro lo escanea. La pantalla llama a
   * `getDisplayPayload()` y renderiza; esta promesa resuelve cuando la UI confirma.
   */
  async send(payload: Uint8Array): Promise<void> {
    if (payload.length > this.maxPayload) {
      throw new Error(
        `Payload de ${payload.length}B supera el limite del QR (${this.maxPayload}B)`,
      );
    }
    this.displayPayload = payload;
  }

  displayPayload?: Uint8Array;

  /** Lo llama la pantalla de camara cuando decodifica un QR. */
  onScanned(data: string): void {
    this.pendingResolve?.(Uint8Array.from(Buffer.from(data, 'base64')));
    this.pendingResolve = undefined;
  }

  async receive(signal?: AbortSignal): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      signal?.addEventListener('abort', () => {
        this.pendingResolve = undefined;
        reject(new Error('Escaneo cancelado'));
      });
    });
  }

  async stop(): Promise<void> {
    this.pendingResolve = undefined;
    this.displayPayload = undefined;
  }
}
