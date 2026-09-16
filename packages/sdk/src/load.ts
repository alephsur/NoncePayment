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
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

import { DEVICE_KEY_FUNDING_LAMPORTS, NONCE_ACCOUNT_LENGTH, PROGRAM_ID } from './constants';
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

/**
 * How many banknotes fit in one transaction. Measured, not guessed: one note plus the
 * device-key top-up serialises to 697 B, two to 987 B, three to 1277 B — past the
 * 1232 B packet limit.
 */
export const NOTES_PER_TRANSACTION = 2;

export interface NoteToLoad {
  /** Free slot index for this owner; see findFreeSlotIndexes(). */
  index: number;
  /** Minor units of the mint. */
  amount: bigint;
}

/**
 * Every transaction a load needs, ready to hand to the wallet.
 *
 * Notes are packed NOTES_PER_TRANSACTION at a time. Each transaction is already
 * partially signed by its fresh nonce keypairs, so the wallet only adds the owner's
 * signature — which is also why `recentBlockhash` comes in as a parameter: it has to be
 * fixed before those signatures, and fetched as late as possible, because the user may
 * take a while to approve.
 *
 * The device-key top-up, if any, rides in the first transaction: it is the only one
 * that is certain to exist.
 */
export function buildLoadTransactions(params: {
  owner: PublicKey;
  authorizedSigner: PublicKey;
  mint: PublicKey;
  notes: NoteToLoad[];
  recentBlockhash: string;
  nonceRentLamports: number;
  deviceKeyTopUpLamports?: number;
}): { transactions: Transaction[]; nonceAccounts: PublicKey[] } {
  if (params.notes.length === 0) throw new Error('Nothing to load');

  const transactions: Transaction[] = [];
  const nonceAccounts: PublicKey[] = [];

  for (let i = 0; i < params.notes.length; i += NOTES_PER_TRANSACTION) {
    const tx = new Transaction();
    tx.feePayer = params.owner;
    tx.recentBlockhash = params.recentBlockhash;

    if (i === 0 && params.deviceKeyTopUpLamports && params.deviceKeyTopUpLamports > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: params.owner,
          toPubkey: params.authorizedSigner,
          lamports: params.deviceKeyTopUpLamports,
        }),
      );
    }

    const signers: Keypair[] = [];
    for (const note of params.notes.slice(i, i + NOTES_PER_TRANSACTION)) {
      const nonceKeypair = Keypair.generate();
      signers.push(nonceKeypair);
      nonceAccounts.push(nonceKeypair.publicKey);

      tx.add(
        SystemProgram.createAccount({
          fromPubkey: params.owner,
          newAccountPubkey: nonceKeypair.publicKey,
          lamports: params.nonceRentLamports,
          space: NONCE_ACCOUNT_LENGTH,
          programId: SystemProgram.programId,
        }),
        SystemProgram.nonceInitialize({
          noncePubkey: nonceKeypair.publicKey,
          authorizedPubkey: params.authorizedSigner,
        }),
        buildOpenSlotInstruction({
          owner: params.owner,
          authorizedSigner: params.authorizedSigner,
          nonceAccount: nonceKeypair.publicKey,
          mint: params.mint,
          index: note.index,
          amount: note.amount,
        }),
      );
    }

    tx.partialSign(...signers);
    transactions.push(tx);
  }

  return { transactions, nonceAccounts };
}

/**
 * Lamports to send the device key so it holds DEVICE_KEY_FUNDING_LAMPORTS again.
 *
 * The device key pays the fee of every voucher it signs, and the recipient's token
 * account rent when they have none, so it has to carry some SOL. Zero when it already
 * holds at least half the target: topping up a few lamports on every load just adds a
 * line to the wallet's approval sheet for nothing.
 */
export async function deviceKeyTopUpLamports(
  connection: Connection,
  deviceKey: PublicKey,
): Promise<number> {
  const balance = await connection.getBalance(deviceKey, 'confirmed');
  return balance >= DEVICE_KEY_FUNDING_LAMPORTS / 2 ? 0 : DEVICE_KEY_FUNDING_LAMPORTS - balance;
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
