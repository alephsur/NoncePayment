/**
 * Comparación de bytes que no depende de tener un Buffer de verdad.
 *
 * `Buffer.prototype.equals` solo existe en el polyfill, y `subarray()` sobre Hermes
 * devuelve un `Uint8Array` plano, no un Buffer: la vista pierde el prototipo. En Node
 * la misma llamada devuelve un Buffer y el método está ahí, así que el fallo no aparece
 * ni en los tests del SDK ni en los scripts de devnet — solo dentro de la app, que es
 * el peor sitio para descubrirlo.
 *
 * Regla, entonces: sobre el resultado de un `subarray()` no se llama a nada que no
 * tenga `Uint8Array`. Ver docs/SPIKE-RESULTS.md, riesgo #1.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Base58, para firmas de transaccion. `PublicKey` solo codifica 32 bytes y una firma
 * tiene 64; `bs58` llega de rebote con web3.js pero sin tipos, y no merece depender de
 * el por una funcion de diez lineas.
 */
export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58[digits[i]];
  return out;
}
