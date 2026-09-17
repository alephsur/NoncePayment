/**
 * La etiqueta de direccion: lo que viaja en el PRIMER tap.
 *
 * El receptor emula su direccion, el pagador la lee, y el teclado desaparece del pago.
 * Escribir 44 caracteres de base58 en un movil no es una alternativa, es una barrera:
 * nadie paga un cafe asi, y el gesto es la mitad del producto.
 *
 * ## Esto NO esta autenticado, y da igual
 *
 * Cualquiera puede emular una etiqueta con la direccion que quiera, asi que leerla no
 * prueba nada sobre quien esta enfrente. No hace falta que lo pruebe: es una direccion
 * de destino, no una autorizacion. Lo que la protege es que **el pagador la ve y la
 * confirma antes de poner la huella**, igual que se mira el numero de cuenta antes de
 * una transferencia. Firmar a ciegas lo que diga un tap seria el fallo; enseñarlo, no.
 *
 * Por eso la etiqueta es diminuta y sin firma. La criptografia esta en el voucher del
 * segundo tap, que es lo que mueve el dinero.
 */
import { PublicKey } from '@solana/web3.js';

export interface AddressTag {
  v: 1;
  /** A quien nombra el voucher: la wallet del receptor, o su clave de dispositivo. */
  recipient: string;
  /**
   * Cual de las dos es. Solo para lo que el pagador ve en pantalla — no se decide nada
   * con ello, y viene del otro telefono, asi que no se le da mas credito que a un rotulo.
   */
  kind?: 'wallet' | 'device';
  /** Lo que se le enseña al usuario. Un dominio .skr cuando lo haya (dia 18). */
  label?: string;
}

/** Marca de version. Lo que no la lleve no es nuestro y se descarta sin ruido. */
const VERSION = 1;

export function encodeAddressTag(tag: AddressTag): Uint8Array {
  return Uint8Array.from(Buffer.from(JSON.stringify(tag), 'utf8'));
}

/**
 * Descodifica y valida. Lanza si lo leido no es una etiqueta nuestra.
 *
 * La validacion de la clave publica no es un formalismo: lo que llega por NFC lo escribe
 * otro telefono, y una direccion mal formada tiene que morir aqui y no dentro de
 * `buildVoucher`, donde el mensaje no diria nada util.
 */
export function decodeAddressTag(bytes: Uint8Array): AddressTag {
  let raw: any;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('El otro movil no ha enviado una direccion de cobro');
  }
  if (raw?.v !== VERSION || typeof raw.recipient !== 'string') {
    throw new Error('El otro movil no ha enviado una direccion de cobro');
  }
  let recipient: PublicKey;
  try {
    recipient = new PublicKey(raw.recipient);
  } catch {
    throw new Error('La direccion de cobro recibida no es valida');
  }
  return {
    v: VERSION,
    recipient: recipient.toBase58(),
    kind: raw.kind === 'wallet' || raw.kind === 'device' ? raw.kind : undefined,
    label: typeof raw.label === 'string' ? raw.label : undefined,
  };
}

/** Distingue la etiqueta de direccion de un voucher, que llega por el mismo canal. */
export function looksLikeAddressTag(bytes: Uint8Array): boolean {
  try {
    const raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return raw?.v === VERSION && typeof raw.recipient === 'string' && !raw.tx;
  } catch {
    return false;
  }
}
