/**
 * Libro local: billetes cargados y vouchers pendientes de liquidar.
 *
 * Nada de esto es secreto (solo claves publicas, valores de nonce y transacciones ya
 * firmadas), asi que va a un fichero normal y no al almacen seguro — que ademas tiene
 * un limite practico de ~2 KB por entrada y aqui se superaria enseguida.
 */
import * as FileSystem from 'expo-file-system';
import type { CachedSlot, VoucherEnvelope } from '@noncepayment/sdk';

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
