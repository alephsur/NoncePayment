/**
 * Carga de billetes (ONLINE).
 *
 * Es el unico momento en que hace falta la wallet real del usuario vía Mobile Wallet
 * Adapter. A partir de aqui, la clave de dispositivo puede gastar sin red.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

import { PROGRAM_ID } from './constants';
import { slotPda, vaultPda } from './pdas';
import { createNonceAccountInstructions } from './nonce';

const OPEN_SLOT_DISCRIMINATOR = sha256(utf8ToBytes('global:open_slot')).slice(0, 8);

export function buildOpenSlotInstruction(params: {
  owner: PublicKey;
  authorizedSigner: PublicKey;
  nonceAccount: PublicKey;
  mint: PublicKey;
  index: number;
  amount: bigint;
}): TransactionInstruction {
  const [slot] = slotPda(params.owner, params.index);
  const [vault] = vaultPda(slot);
  const ownerAta = getAssociatedTokenAddressSync(params.mint, params.owner);

  const data = Buffer.alloc(18);
  Buffer.from(OPEN_SLOT_DISCRIMINATOR).copy(data, 0);
  data.writeUInt16LE(params.index, 8);
  data.writeBigUInt64LE(params.amount, 10);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.authorizedSigner, isSigner: false, isWritable: false },
      { pubkey: slot, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: ownerAta, isSigner: false, isWritable: true },
      { pubkey: params.nonceAccount, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      {
        pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'),
        isSigner: false,
        isWritable: false,
      },
    ],
  });
}

/**
 * Instrucciones para cargar un billete: crear el nonce account + abrir el slot.
 *
 * Devuelve tambien el keypair del nonce, que debe firmar la transaccion junto al owner.
 * Se puede meter mas de un billete por transaccion, pero ojo con el limite de 1232 bytes.
 */
export async function buildLoadNoteInstructions(
  connection: Connection,
  params: {
    owner: PublicKey;
    authorizedSigner: PublicKey;
    mint: PublicKey;
    index: number;
    amount: bigint;
  },
): Promise<{ instructions: TransactionInstruction[]; nonceKeypair: Keypair }> {
  const nonceKeypair = Keypair.generate();

  const nonceIxs = await createNonceAccountInstructions(
    connection,
    params.owner,
    nonceKeypair,
    params.authorizedSigner,
  );

  return {
    nonceKeypair,
    instructions: [
      ...nonceIxs,
      buildOpenSlotInstruction({ ...params, nonceAccount: nonceKeypair.publicKey }),
    ],
  };
}

/** Coste real de renta por billete, para enseñarselo al usuario antes de cargar. */
export async function estimateNoteRentLamports(
  connection: Connection,
): Promise<number> {
  const nonce = await connection.getMinimumBalanceForRentExemption(80);
  const slotAccount = await connection.getMinimumBalanceForRentExemption(8 + 148);
  const vault = await connection.getMinimumBalanceForRentExemption(165);
  return nonce + slotAccount + vault;
}

export { ASSOCIATED_TOKEN_PROGRAM_ID };
