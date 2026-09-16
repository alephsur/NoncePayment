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
