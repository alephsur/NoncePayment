/**
 * Transporte NFC (HCE). El momento "wow" del video.
 *
 * ================== LEE ESTO ANTES DE TOCAR NADA ==================
 * Este es el componente MAS FRAGIL del proyecto y tiene fecha de caducidad:
 *
 *   REGLA DURA DEL ROADMAP: si el dia 4 esto no funciona entre dos moviles reales,
 *   se borra el fichero, se quita del selector de transportes y se sigue con BLE + QR.
 *   Sin "un dia mas". Ver docs/ROADMAP.md, fase 0.
 *
 * Por eso el NFC NO transporta el voucher: solo el handshake de 32 bytes. Si cae, lo
 * unico que se pierde es el gesto del tap, no la funcionalidad.
 * ==================================================================
 *
 * Android mato Android Beam en Android 10, asi que movil-a-movil hoy significa:
 * un lado en HCE (emula una tarjeta) y el otro en modo lector.
 */
import { Transport, NfcHandshake, MAX_NFC_BYTES } from './types';

export class NfcTransport implements Transport {
  readonly id = 'nfc' as const;
  readonly label = 'NFC';
  readonly maxPayload = MAX_NFC_BYTES;

  async isAvailable() {
    try {
      const NfcManager = require('react-native-nfc-manager').default;
      const supported = await NfcManager.isSupported();
      if (!supported) return { available: false, reason: 'Dispositivo sin NFC' };
      const enabled = await NfcManager.isEnabled();
      if (!enabled) return { available: false, reason: 'NFC desactivado en ajustes' };
      return { available: true };
    } catch (e: any) {
      return { available: false, reason: e?.message ?? 'NFC no disponible' };
    }
  }

  /** Emula una tarjeta con el handshake dentro. El otro movil lo lee acercandose. */
  async send(payload: Uint8Array): Promise<void> {
    if (payload.length > this.maxPayload) {
      throw new Error(
        `El NFC solo lleva el handshake (${this.maxPayload}B), no el voucher. ` +
          `Recibidos ${payload.length}B.`,
      );
    }
    // TODO(spike dia 1-4): react-native-hce
    //   const { HCESession, NFCTagType4, NFCTagType4NDEFContentType } = require('react-native-hce');
    //   const tag = new NFCTagType4({
    //     type: NFCTagType4NDEFContentType.Text,
    //     content: Buffer.from(payload).toString('base64'),
    //     writable: false,
    //   });
    //   const session = await HCESession.getInstance();
    //   await session.setApplication(tag);
    //   await session.setEnabled(true);
    throw new Error('HCE pendiente del spike');
  }

  async receive(): Promise<Uint8Array> {
    // TODO(spike dia 1-4): NfcManager en modo lector sobre nuestro AID.
    throw new Error('Lector NFC pendiente del spike');
  }

  async stop(): Promise<void> {
    try {
      const NfcManager = require('react-native-nfc-manager').default;
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
    } catch {
      /* modulo no enlazado todavia */
    }
  }
}

export function encodeHandshake(h: NfcHandshake): Uint8Array {
  return Uint8Array.from(Buffer.from(JSON.stringify(h), 'utf8'));
}

export function decodeHandshake(bytes: Uint8Array): NfcHandshake {
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}
