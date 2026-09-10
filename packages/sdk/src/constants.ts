import { PublicKey } from '@solana/web3.js';

/** Comes from `anchor keys sync`. Not deployed to devnet yet (roadmap day 9). */
export const PROGRAM_ID = new PublicKey(
  'CwwpVy2fL2NoVYS1wZgvhfpumoCCQdmZd8194uKRpDo7',
);

/** USDC devnet. En mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v */
export const USDC_MINT_DEVNET = new PublicKey(
  'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
);

export const USDC_DECIMALS = 6;

/**
 * Denominaciones fijas de billete, en USDC.
 *
 * Decision de diseno deliberada: importes fijos simplifican el programa, hacen el
 * riesgo de doble gasto acotado y predecible, y refuerzan la metafora del efectivo.
 */
export const NOTE_DENOMINATIONS = [1, 5, 20, 50] as const;
export type NoteDenomination = (typeof NOTE_DENOMINATIONS)[number];

/** Maximo de billetes simultaneos. Cada uno cuesta renta; ver docs/ARCHITECTURE.md. */
export const MAX_SLOTS = 32;

/** Un nonce account del System Program ocupa exactamente 80 bytes. */
export const NONCE_ACCOUNT_LENGTH = 80;

/** Indice de AdvanceNonceAccount dentro del enum SystemInstruction. */
export const SYSTEM_IX_ADVANCE_NONCE = 4;

/** SOL que se deja en la clave de dispositivo para cubrir fees y renta de ATAs. */
export const DEVICE_KEY_FUNDING_LAMPORTS = 10_000_000; // 0.01 SOL
