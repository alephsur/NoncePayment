/**
 * Reclaim (ONLINE): la salida de emergencia del dueño.
 *
 * Un billete solo lo puede gastar la clave de dispositivo que se nombro al abrirlo. Si
 * esa clave desaparece — Android la destruye al cambiar la huella, o el usuario
 * reinstala, o cambia de movil — el dinero sigue ahi, bloqueado en su vault, y ya no hay
 * nadie capaz de firmar un voucher contra el. `reclaim` es lo que lo devuelve, y solo lo
 * puede pedir el dueño, con su wallet real.
 *
 * Es la contrapartida honesta del diseño: delegar en una clave del telefono es lo que
 * permite pagar sin cobertura, y esto es lo que impide que esa delegacion se convierta
 * en una forma de perder dinero.
 *
 * ## Lo que NO devuelve
 *
 * La renta del nonce account. `reclaim` cierra el slot y el vault, que es donde esta el
 * USDC y la mayor parte de la renta, pero el nonce es una cuenta del System Program cuya
 * autoridad es la clave de dispositivo — precisamente la que ya no existe. Nadie puede
 * cerrarla. Son unos 0.0014 SOL por billete que se quedan ahi, y conviene decirlo en vez
 * de fingir que la recuperacion es total.
 */
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

import { PROGRAM_ID } from './constants';
import { slotPda, vaultPda } from './pdas';

const RECLAIM_DISCRIMINATOR = sha256(utf8ToBytes('global:reclaim')).slice(0, 8);

/**
 * Cuantos rescates caben en una transaccion. Medido, no estimado.
 *
 * La base son 336 B y cada rescate añade 81: ocho salen a 984 B. Caben once (1227 B),
 * pero el limite del paquete son 1232 y no hay ninguna razon para jugarsela por tres
 * billetes — pasarse no falla al firmar, falla al enviar.
 */
export const RECLAIMS_PER_TRANSACTION = 8;

export function buildReclaimInstruction(params: {
  owner: PublicKey;
  index: number;
  mint: PublicKey;
}): TransactionInstruction {
  const [slot] = slotPda(params.owner, params.index);
  const [vault] = vaultPda(slot);
  const ownerAta = getAssociatedTokenAddressSync(params.mint, params.owner);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(RECLAIM_DISCRIMINATOR),
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: slot, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: ownerAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

/**
 * Empaqueta varios rescates en las menos transacciones posibles.
 *
 * Una aprobacion de wallet por transaccion, asi que menos transacciones es menos
 * fricción — pero pasarse del limite de 1232 bytes no falla al firmar, falla al enviar,
 * que es el peor sitio para enterarse.
 *
 * La cuenta de tokens del dueño se crea de forma idempotente una vez por transaccion:
 * es a donde vuelve el dinero, y un dueño que la hubiera cerrado se encontraria si no
 * con un rescate que revierte sin explicar por que.
 */
export function buildReclaimTransactions(params: {
  owner: PublicKey;
  mint: PublicKey;
  indexes: number[];
  recentBlockhash: string;
}): Transaction[] {
  const { owner, mint, indexes, recentBlockhash } = params;
  if (indexes.length === 0) throw new Error('No hay nada que recuperar');

  const ownerAta = getAssociatedTokenAddressSync(mint, owner);
  const out: Transaction[] = [];

  for (let i = 0; i < indexes.length; i += RECLAIMS_PER_TRANSACTION) {
    const tx = new Transaction();
    tx.feePayer = owner;
    tx.recentBlockhash = recentBlockhash;
    tx.add(createAssociatedTokenAccountIdempotentInstruction(owner, ownerAta, owner, mint));
    for (const index of indexes.slice(i, i + RECLAIMS_PER_TRANSACTION)) {
      tx.add(buildReclaimInstruction({ owner, index, mint }));
    }
    out.push(tx);
  }
  return out;
}
