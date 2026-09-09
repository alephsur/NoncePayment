import { USDC_DECIMALS } from '@noncepayment/sdk';

/** Unidades minimas -> texto legible. 20000000n -> "20.00" */
export function formatUsdc(units: bigint): string {
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = units / base;
  const frac = units % base;
  return `${whole}.${frac.toString().padStart(USDC_DECIMALS, '0').slice(0, 2)}`;
}

/** "20.5" -> 20500000n */
export function parseUsdc(text: string): bigint {
  const [w, f = ''] = text.replace(',', '.').split('.');
  const frac = (f + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(w || '0') * 10n ** BigInt(USDC_DECIMALS) + BigInt(frac || '0');
}

export function shortKey(key: string): string {
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
