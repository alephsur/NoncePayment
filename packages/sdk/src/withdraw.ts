/**
 * Retirada (ONLINE): pasar a la wallet el USDC que se ha cobrado.
 *
 * Lo que se cobra en un pago no es un billete. `redeem` lo deja en la cuenta de tokens
 * de la clave de dispositivo del receptor, como USDC normal y corriente, y desde ahi no
 * se puede volver a pagar sin cobertura: un billete es USDC bloqueado *mas* un nonce de
 * un solo uso *mas* un slot, y esto es solo lo primero.
 *
 * Asi que hace falta una salida, y sin ella el dinero entra y no vuelve a salir nunca:
 * la clave privada vive en el Keystore de Android detras de la biometria y no sale del
 * telefono, de modo que ninguna otra herramienta — ni la CLI, ni otra wallet — puede
 * firmar este movimiento. O lo hace la app, o no lo hace nadie.
 *
 * ## Quien paga la comision, y por que no la clave de dispositivo
 *
 * La transaccion la firman DOS: la clave de dispositivo, que es la autoridad de los
 * tokens, y la wallet, que es quien paga el fee. Podria pagarlo la clave de dispositivo,
 * pero solo recibe SOL cuando ESE movil carga billetes — y un telefono que unicamente
 * cobra no carga nunca. Pagarlo desde la wallet es lo que hace que un movil que solo
 * cobra no necesite SOL jamas: ni para cobrar, ni para retirar.
 *
 * Retirar exige red por definicion, y el destino es la propia wallet, asi que pedir que
 * este conectada no añade ninguna restriccion que no estuviera ya ahi.
 */
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

export interface WithdrawParams {
  /** Autoridad de los tokens. Firma, pero no paga. */
  deviceKey: PublicKey;
  /** Destino y fee payer: la wallet real del usuario. */
  wallet: PublicKey;
  mint: PublicKey;
  decimals: number;
  /** Unidades minimas. */
  amount: bigint;
  recentBlockhash: string;
}

/**
 * Transaccion de retirada, sin firmar.
 *
 * El orden importa poco aqui, pero el ATA idempotente va primero por la misma razon que
 * en el voucher: el destino puede no tener cuenta de ese mint todavia, y crearla de
 * forma idempotente hace que reintentar la retirada sea inofensivo.
 */
export function buildWithdrawTransaction(params: WithdrawParams): Transaction {
  const { deviceKey, wallet, mint, decimals, amount, recentBlockhash } = params;

  if (amount <= 0n) throw new Error('El importe a retirar tiene que ser mayor que cero');

  const from = getAssociatedTokenAddressSync(mint, deviceKey);
  const to = getAssociatedTokenAddressSync(mint, wallet);

  const tx = new Transaction();
  tx.feePayer = wallet;
  tx.recentBlockhash = recentBlockhash;
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(wallet, to, wallet, mint),
    createTransferCheckedInstruction(from, mint, to, deviceKey, amount, decimals),
  );
  return tx;
}
