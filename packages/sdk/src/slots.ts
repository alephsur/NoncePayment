/**
 * Reading banknotes back from the chain.
 *
 * The phone's ledger is a cache, and a cache can be lost: a reinstall, a crash between
 * the wallet confirming a load and the app writing it down. The chain cannot. Every slot
 * lives at a PDA derived from (owner, index), and the index space is small (MAX_SLOTS),
 * so the whole set of an owner's banknotes is one getMultipleAccountsInfo away.
 *
 * That makes the chain the source of truth for loading: the app sends the transactions,
 * then rebuilds what it knows from here, and a load that was confirmed but never cached
 * simply shows up on the next sync.
 */
import { Connection, NonceAccount, PublicKey } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

import { bytesEqual } from './bytes';
import { MAX_SLOTS, NONCE_ACCOUNT_LENGTH } from './constants';
import { slotPda } from './pdas';

const SLOT_DISCRIMINATOR = sha256(utf8ToBytes('account:Slot')).slice(0, 8);

/** 8 bytes of Anchor discriminator + Slot::LEN (148). */
export const SLOT_ACCOUNT_LENGTH = 8 + 148;

/** Mirrors `Slot` in programs/nonce-payment/src/lib.rs, field for field. */
export interface OnChainSlot {
  address: PublicKey;
  owner: PublicKey;
  authorizedSigner: PublicKey;
  nonceAccount: PublicKey;
  mint: PublicKey;
  amount: bigint;
  index: number;
  createdAt: number;
}

export interface OwnerSlot extends OnChainSlot {
  /** The blockhash stored in the nonce account: what the phone signs against offline. */
  nonceValue: string | null;
  /**
   * Whether the nonce account's authority is the slot's authorized signer. If not, the
   * device key cannot advance the nonce, so no voucher for this banknote could ever land.
   */
  nonceAuthorityMatches: boolean;
}

export function decodeSlot(address: PublicKey, data: Buffer | Uint8Array): OnChainSlot {
  const buf = Buffer.from(data);
  if (buf.length < SLOT_ACCOUNT_LENGTH) {
    throw new Error(`Slot account too short: ${buf.length} bytes`);
  }
  if (!bytesEqual(buf.subarray(0, 8), SLOT_DISCRIMINATOR)) {
    throw new Error('Not a Slot account (discriminator mismatch)');
  }

  let o = 8;
  const key = () => {
    const k = new PublicKey(buf.subarray(o, o + 32));
    o += 32;
    return k;
  };
  const owner = key();
  const authorizedSigner = key();
  const nonceAccount = key();
  const mint = key();
  const amount = buf.readBigUInt64LE(o);
  o += 8;
  const index = buf.readUInt16LE(o);
  o += 2 + 1 + 1; // index, bump, vault_bump
  const createdAt = Number(buf.readBigInt64LE(o));

  return { address, owner, authorizedSigner, nonceAccount, mint, amount, index, createdAt };
}

/**
 * Every open banknote of `owner`, with its current nonce value.
 *
 * Two RPC calls whatever the count: one for all the slot PDAs, one for their nonces.
 */
export async function fetchOwnerSlots(
  connection: Connection,
  owner: PublicKey,
  maxSlots: number = MAX_SLOTS,
): Promise<OwnerSlot[]> {
  const addresses = Array.from({ length: maxSlots }, (_, i) => slotPda(owner, i)[0]);
  const infos = await connection.getMultipleAccountsInfo(addresses, 'confirmed');

  const slots = infos.flatMap((info, i) =>
    info ? [decodeSlot(addresses[i], info.data)] : [],
  );
  if (slots.length === 0) return [];

  const nonceInfos = await connection.getMultipleAccountsInfo(
    slots.map((s) => s.nonceAccount),
    'confirmed',
  );

  return slots.map((slot, i) => {
    const info = nonceInfos[i];
    if (!info || info.data.length !== NONCE_ACCOUNT_LENGTH) {
      return { ...slot, nonceValue: null, nonceAuthorityMatches: false };
    }
    try {
      const nonce = NonceAccount.fromAccountData(info.data);
      return {
        ...slot,
        nonceValue: nonce.nonce,
        nonceAuthorityMatches: nonce.authorizedPubkey.equals(slot.authorizedSigner),
      };
    } catch {
      // An account that is 80 bytes and System-owned but not initialised as a nonce.
      return { ...slot, nonceValue: null, nonceAuthorityMatches: false };
    }
  });
}

/**
 * The lowest `count` indexes with no slot on chain, skipping any in `reserved`.
 *
 * `reserved` is for indexes the phone knows about that the chain may not show yet — a
 * load sent a moment ago, still below `confirmed`. Reusing one would make `init` fail.
 */
export async function findFreeSlotIndexes(
  connection: Connection,
  owner: PublicKey,
  count: number,
  reserved: Iterable<number> = [],
  maxSlots: number = MAX_SLOTS,
): Promise<number[]> {
  const addresses = Array.from({ length: maxSlots }, (_, i) => slotPda(owner, i)[0]);
  const infos = await connection.getMultipleAccountsInfo(addresses, 'confirmed');
  const taken = new Set(reserved);

  const free = infos.flatMap((info, i) => (info || taken.has(i) ? [] : [i]));
  if (free.length < count) {
    throw new Error(
      `Only ${free.length} free banknote slots left (maximum ${maxSlots}); asked for ${count}`,
    );
  }
  return free.slice(0, count);
}
