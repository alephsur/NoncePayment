/**
 * NFC transport (HCE). The "wow" moment of the video.
 *
 * ================== READ THIS BEFORE TOUCHING ANYTHING ==================
 * This is the MOST FRAGILE component in the project, and it has an expiry date:
 *
 *   HARD RULE FROM THE ROADMAP: if on day 4 this does not work between two real phones,
 *   the file is deleted, it is dropped from the transport selector, and we carry on with
 *   BLE + QR. No "just one more day". See docs/ROADMAP.md, phase 0.
 *
 * That is why NFC does NOT carry the voucher: only the handshake. If it goes, all we lose
 * is the tap gesture, not the functionality.
 * ========================================================================
 *
 * Android killed Android Beam in Android 10, so phone-to-phone today means one side in
 * HCE (emulating a card) and the other in reader mode.
 *
 * What travels: an NDEF Type 4 tag with a single text record, and the text is the payload
 * in base64. It is the only thing react-native-hce can emulate, and in exchange the reader
 * is Android's standard NDEF reader, with no hand-rolled APDUs.
 *
 * The library is patched (patches/react-native-hce+0.3.0.patch): without the patch only
 * the first tap works and every later one gets 6A82.
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

  /**
   * Emulates a tag with the payload inside. The other phone reads it by moving close.
   *
   * Resolves once a reader has read and moved away. Emulation STAYS on afterwards:
   * stop() turns it off. That way several taps can be chained against the same payload.
   *
   * Caveat: "read" is what the service reports (at least one READ in the session). A
   * reader that only reads the CC file and leaves counts too. The receiving side holds
   * the truth; here it is just a hint for the UI.
   */
  async send(payload: Uint8Array, signal?: AbortSignal): Promise<void> {
    if (payload.length > this.maxPayload) {
      throw new Error(
        `El NFC solo lleva el handshake (${this.maxPayload}B), no el voucher. ` +
          `Recibidos ${payload.length}B.`,
      );
    }

    const { HCESession, NFCTagType4, NFCTagType4NDEFContentType } = require('react-native-hce');
    const session = await HCESession.getInstance();
    await session.setApplication(
      new NFCTagType4({
        type: NFCTagType4NDEFContentType.Text,
        content: Buffer.from(payload).toString('base64'),
        writable: false,
      }),
    );
    await session.setEnabled(true);

    await new Promise<void>((resolve, reject) => {
      let read = false;
      const offRead = session.on(HCESession.Events.HCE_STATE_READ, () => {
        read = true;
      });
      const offDisconnected = session.on(HCESession.Events.HCE_STATE_DISCONNECTED, () => {
        if (!read) return;
        cleanup();
        resolve();
      });
      const onAbort = () => {
        cleanup();
        reject(new Error('Emulacion NFC cancelada'));
      };
      const cleanup = () => {
        offRead();
        offDisconnected();
        signal?.removeEventListener('abort', onAbort);
      };

      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort);
    });
  }

  /**
   * Reader mode: waits for an NDEF tag and returns the payload it carries.
   *
   * Reader mode, not foreground dispatch: while it is on, this phone stops listening as a
   * card, so even with its own emulation switched on it neither reads itself nor clashes
   * with the other phone.
   */
  async receive(signal?: AbortSignal): Promise<Uint8Array> {
    const {
      default: NfcManager,
      NfcTech,
      NfcAdapter,
      Ndef,
    } = require('react-native-nfc-manager');

    const onAbort = () => {
      NfcManager.cancelTechnologyRequest().catch(() => undefined);
    };
    if (signal?.aborted) throw new Error('Lectura NFC cancelada');
    signal?.addEventListener('abort', onAbort);

    try {
      await NfcManager.start();
      await NfcManager.requestTechnology(NfcTech.Ndef, {
        isReaderModeEnabled: true,
        readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B,
      });
      if (signal?.aborted) throw new Error('Lectura NFC cancelada');

      const tag = await NfcManager.getTag();
      const record = tag?.ndefMessage?.[0];
      if (!record) throw new Error('La etiqueta no trae ningun mensaje NDEF');

      const isText =
        record.tnf === Ndef.TNF_WELL_KNOWN &&
        Buffer.from(record.type).toString('latin1') === Ndef.RTD_TEXT;
      if (!isText) throw new Error('La etiqueta no es de NoncePayment (no es un registro de texto)');

      const base64 = Ndef.text.decodePayload(Uint8Array.from(record.payload));
      return Uint8Array.from(Buffer.from(base64, 'base64'));
    } catch (e) {
      if (signal?.aborted) throw new Error('Lectura NFC cancelada');
      throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
    }
  }

  /** Turns off both halves: the emulation and any read in progress. */
  async stop(): Promise<void> {
    try {
      const NfcManager = require('react-native-nfc-manager').default;
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
    } catch {
      /* module not linked yet */
    }
    try {
      const { HCESession } = require('react-native-hce');
      const session = await HCESession.getInstance();
      if (session.enabled) await session.setEnabled(false);
    } catch {
      /* module not linked yet */
    }
  }
}

export function encodeHandshake(h: NfcHandshake): Uint8Array {
  return Uint8Array.from(Buffer.from(JSON.stringify(h), 'utf8'));
}

export function decodeHandshake(bytes: Uint8Array): NfcHandshake {
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}
