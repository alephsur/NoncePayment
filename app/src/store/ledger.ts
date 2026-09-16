/**
 * Libro local: billetes cargados y vouchers pendientes de liquidar.
 *
 * Nada de esto es secreto (solo claves publicas, valores de nonce y transacciones ya
 * firmadas), asi que va a un fichero normal y no al almacen seguro — que ademas tiene
 * un limite practico de ~2 KB por entrada y aqui se superaria enseguida.
 */
import * as FileSystem from 'expo-file-system';
import type { CachedSlot, OwnerSlot, VoucherEnvelope } from '@noncepayment/sdk';

const LEDGER_PATH = `${FileSystem.documentDirectory}noncepay-ledger.v1.json`;

export interface PendingVoucher {
  envelope: VoucherEnvelope;
  direction: 'sent' | 'received';
  receivedAt: string;
  settledSignature?: string;
  lastError?: string;
  attempts: number;
}

export interface Ledger {
  slots: CachedSlot[];
  pending: PendingVoucher[];
  ownerPubkey?: string;
  lastSyncAt?: string;
}

const EMPTY: Ledger = { slots: [], pending: [] };

export async function readLedger(): Promise<Ledger> {
  try {
    const info = await FileSystem.getInfoAsync(LEDGER_PATH);
    if (!info.exists) return { ...EMPTY };
    const raw = await FileSystem.readAsStringAsync(LEDGER_PATH);
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY };
  }
}

export async function writeLedger(ledger: Ledger): Promise<void> {
  await FileSystem.writeAsStringAsync(LEDGER_PATH, JSON.stringify(ledger));
}

export async function updateLedger(
  fn: (l: Ledger) => Ledger | Promise<Ledger>,
): Promise<Ledger> {
  const next = await fn(await readLedger());
  await writeLedger(next);
  return next;
}

/** Billetes disponibles, del mas pequeño al mas grande: se gasta suelto primero. */
export function availableNotes(ledger: Ledger): CachedSlot[] {
  return ledger.slots
    .filter((s) => s.status === 'available')
    .sort((a, b) => Number(BigInt(a.amount) - BigInt(b.amount)));
}

/** Saldo gastable offline, en unidades minimas. */
export function offlineBalance(ledger: Ledger): bigint {
  return availableNotes(ledger).reduce((acc, s) => acc + BigInt(s.amount), 0n);
}

/** Elige el billete mas pequeño que cubra el importe. */
export function selectNote(ledger: Ledger, amount: bigint): CachedSlot | undefined {
  return availableNotes(ledger).find((s) => BigInt(s.amount) >= amount);
}

export interface SyncReport {
  /** Banknotes on chain this phone can spend. */
  spendable: number;
  /** Open on chain but naming another device key — a previous install. They need reclaim. */
  foreign: number;
  /** Open on chain but whose nonce this key cannot advance. Unspendable; need reclaim. */
  broken: number;
}

/**
 * Folds what the chain says into the ledger, for one owner.
 *
 * The chain decides which banknotes exist; the phone only knows one thing the chain
 * cannot: that it already signed a voucher for a banknote which has not landed yet. So:
 *
 * - On chain and ours → cached, `available` — unless the phone marked it spent, in which
 *   case it stays spent. Flipping it back would invite paying twice with the same note.
 * - Cached, but gone from chain → it was closed. By our voucher landing if we had spent it
 *   (`settled`); otherwise by the owner reclaiming it (`reclaimed`).
 * - Another owner's banknotes are left exactly as they were.
 *
 * A banknote is identified by its nonce account, not its index: once one closes, a later
 * load can reuse the index, and the two must not be confused.
 */
export function mergeChainSlots(
  ledger: Ledger,
  chain: OwnerSlot[],
  owner: string,
  deviceKey: string,
  now: string = new Date().toISOString(),
): { ledger: Ledger; report: SyncReport } {
  const report: SyncReport = { spendable: 0, foreign: 0, broken: 0 };
  const local = new Map(
    ledger.slots.filter((s) => s.owner === owner).map((s) => [s.nonceAccount, s]),
  );

  const fromChain: CachedSlot[] = [];
  for (const c of chain) {
    if (c.authorizedSigner.toBase58() !== deviceKey) {
      report.foreign++;
      continue;
    }
    if (!c.nonceValue || !c.nonceAuthorityMatches) {
      report.broken++;
      continue;
    }
    report.spendable++;

    const nonceAccount = c.nonceAccount.toBase58();
    const known = local.get(nonceAccount);
    local.delete(nonceAccount);
    fromChain.push({
      index: c.index,
      owner,
      authorizedSigner: deviceKey,
      nonceAccount,
      nonceValue: c.nonceValue,
      mint: c.mint.toBase58(),
      amount: c.amount.toString(),
      syncedAt: now,
      status: known?.status === 'spent_pending_settlement' ? known.status : 'available',
    });
  }

  // Whatever is left in `local` was cached but no longer exists on chain.
  const closed: CachedSlot[] = [...local.values()].map((s) =>
    s.status === 'spent_pending_settlement'
      ? { ...s, status: 'settled' }
      : s.status === 'available'
        ? { ...s, status: 'reclaimed' }
        : s,
  );

  return {
    ledger: {
      ...ledger,
      ownerPubkey: owner,
      lastSyncAt: now,
      slots: [
        ...ledger.slots.filter((s) => s.owner !== owner),
        ...fromChain,
        ...closed,
      ],
    },
    report,
  };
}
