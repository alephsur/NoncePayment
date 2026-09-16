/**
 * NFC transport (HCE). The "wow" moment of the video.
 *
 * It came with an expiry date — the day-4 hard rule: if it did not move 32 bytes between
 * two real phones it was to be deleted and the plan continued on BLE + QR. **It passed,
 * and by a distance**: a whole signed voucher of 1055 B, 11 reads out of 11, in both
 * directions, OnePlus Nord 2 ↔ Seeker. So it carries the payment, not just a handshake,
 * and BLE came off the critical path. See docs/SPIKE-RESULTS.md, spike 03.
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
  readonly maxPayload: number;

  /**
   * `maxPayload` defaults to a whole voucher's worth. That is what spike 03 changed: the
   * old default was the 255 B handshake the pre-spike design assumed was the ceiling.
   */
  constructor(options: { maxPayload?: number } = {}) {
    this.maxPayload = options.maxPayload ?? MAX_NFC_BYTES;
  }

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
        `El pago no cabe en un tap: ${payload.length}B para un presupuesto de ` +
          `${this.maxPayload}B. Usa el QR.`,
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
   * Reader mode: waits until a tap actually delivers a payload.
   *
   * The subtlety that cost a failed payment: `requestTechnology` resolves as soon as the
   * tag is DISCOVERED, and the tag it caches at that moment usually has no NDEF message
   * yet. With HCE the content only arrives after several APDU round trips, so a short tap
   * — phones touched and pulled apart — discovers a tag and nothing else. Reading
   * `tag.ndefMessage` there gave "la etiqueta no trae ningun mensaje NDEF" and killed the
   * whole receive, when the honest answer was "that tap was too short, try again".
   *
   * So: ask for the message EXPLICITLY, which reads it from the tag then and there, and
   * treat a tap that yields nothing as a tap that did not happen. The loop keeps waiting
   * instead of failing, because the user is standing there holding two phones and the
   * only sane instruction is "hold them together a moment longer".
   *
   * Reader mode, not foreground dispatch: while it is on, this phone stops listening as a
   * card, so even with its own emulation switched on it neither reads itself nor clashes
   * with the other phone.
   */
  async receive(signal?: AbortSignal): Promise<Uint8Array> {
    const { default: NfcManager, NfcTech, NfcAdapter } = require('react-native-nfc-manager');

    const onAbort = () => {
      NfcManager.cancelTechnologyRequest().catch(() => undefined);
    };
    if (signal?.aborted) throw new Error('Lectura NFC cancelada');
    signal?.addEventListener('abort', onAbort);

    try {
      await NfcManager.start();

      for (;;) {
        if (signal?.aborted) throw new Error('Lectura NFC cancelada');
        try {
          await NfcManager.requestTechnology(NfcTech.Ndef, {
            isReaderModeEnabled: true,
            readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B,
          });
          if (signal?.aborted) throw new Error('Lectura NFC cancelada');

          const payload = await this.readTapPayload();
          if (payload) return payload;
        } catch (e) {
          if (signal?.aborted) throw new Error('Lectura NFC cancelada');
          // A tap that broke halfway is not an error worth showing: it is a tap. Only an
          // abort leaves this loop.
        } finally {
          await NfcManager.cancelTechnologyRequest().catch(() => undefined);
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
    }
  }

  /**
   * The payload of the tag currently in the field, or null if this tap did not carry one.
   *
   * Two attempts: the phones are usually still touching, and the second read costs
   * milliseconds where making the user tap again costs a gesture.
   */
  private async readTapPayload(): Promise<Uint8Array | null> {
    const { default: NfcManager, Ndef } = require('react-native-nfc-manager');

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 120));

      let record: any = null;
      try {
        // Reads the message from the tag now, rather than trusting what discovery cached.
        const message = await NfcManager.ndefHandler.getNdefMessage();
        record = message?.ndefMessage?.[0] ?? (Array.isArray(message) ? message[0] : null);
      } catch {
        /* the tag left the field mid-read */
      }
      if (!record) {
        const tag = await NfcManager.getTag().catch(() => null);
        record = tag?.ndefMessage?.[0] ?? null;
      }
      if (!record) continue;

      const isText =
        record.tnf === Ndef.TNF_WELL_KNOWN &&
        Buffer.from(record.type).toString('latin1') === Ndef.RTD_TEXT;
      if (!isText) {
        throw new Error('La etiqueta no es de NoncePayment (no es un registro de texto)');
      }

      const base64 = Ndef.text.decodePayload(Uint8Array.from(record.payload));
      return Uint8Array.from(Buffer.from(base64, 'base64'));
    }
    return null;
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

/**
 * Apaga cualquier emulacion de tarjeta, tambien la que dejo otra ejecucion.
 *
 * `react-native-hce` guarda en SharedPreferences tanto el contenido de la etiqueta como
 * su flag `enabled`, y vuelve a levantar el servicio por su cuenta. Un voucher que se
 * quedo emulando sobrevive por tanto a un force-stop, a un reinicio y a dias sin abrir
 * la app: el telefono sigue ofreciendo un instrumento al portador a cualquier lector que
 * se acerque, sin nada en pantalla que lo diga.
 *
 * No es hipotetico. El 16 de septiembre el Seeker seguia sirviendo un voucher del spike
 * del dia 14 — y lo que leyo el otro movil en la primera prueba de pago fue eso, no el
 * pago. Por eso esto se llama al arrancar, no solo al salir de la pantalla de pago.
 */
export async function stopCardEmulation(): Promise<void> {
  await new NfcTransport().stop();
}

export function encodeHandshake(h: NfcHandshake): Uint8Array {
  return Uint8Array.from(Buffer.from(JSON.stringify(h), 'utf8'));
}

export function decodeHandshake(bytes: Uint8Array): NfcHandshake {
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}
