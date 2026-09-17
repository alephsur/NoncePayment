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
  /**
   * What the last sync found. Persisted, not just returned, because the banknotes this
   * phone cannot spend are real money and the user has to keep seeing them — not only
   * in the second after a load, which is where the number used to die.
   */
  lastSyncReport?: SyncReport;
  /**
   * USDC cobrado: lo que hay en la cuenta de tokens de la clave de dispositivo, en
   * unidades minimas. Cacheado para que se vea tambien sin cobertura — es dinero que
   * entro por un pago y el movil no puede quedarse callado sobre el solo porque no haya
   * red. Un string, que esto es JSON.
   */
  receivedUsdc?: string;
  /**
   * Lo que sabemos de los billetes AJENOS que nos han pagado, por PDA del slot.
   *
   * Es lo que hace posible el nivel intermedio de verificacion sin cobertura. La firma
   * de un voucher se comprueba sin red, pero que el billete siga con dinero detras no —
   * salvo que ya lo hayamos mirado alguna vez. Un pagador habitual se convierte asi en
   * alguien de quien se puede decir algo mas que «la firma es buena».
   */
  slotChecks?: Record<string, SlotCheck>;
}

export interface SlotCheck {
  /** El slot existia en la cadena y por tanto seguia con su colateral. */
  funded: boolean;
  /** ISO 8601. Un dato viejo vale menos, y el usuario tiene que poder verlo. */
  at: string;
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

/**
 * Billetes que existen en la cadena y que este movil NO puede gastar.
 *
 * Sale del ultimo informe de sincronizacion, no de `slots`, y a proposito: un billete
 * asi nunca se cachea como slot, porque cachearlo seria ofrecer para pagar un dinero
 * que este telefono no puede mover. Pero tiene que verse — es dinero real, bloqueado —
 * y por eso el recuento viaja en el informe.
 */
export function unspendableNotes(ledger: Ledger): {
  count: number;
  amount: bigint;
  notes: StuckNote[];
} {
  const report = ledger.lastSyncReport;
  if (!report) return { count: 0, amount: 0n, notes: [] };
  return {
    count: report.foreign + report.broken,
    amount: BigInt(report.unspendable ?? '0'),
    notes: report.stuck ?? [],
  };
}

/**
 * USDC cobrado que vive en la clave de dispositivo.
 *
 * No es efectivo offline y por eso no suma al saldo grande de la home: es USDC normal y
 * corriente, y moverlo exige red. Pero es dinero del usuario y tiene que verse.
 */
export function receivedBalance(ledger: Ledger): bigint {
  return BigInt(ledger.receivedUsdc ?? '0');
}

/** Lo ultimo que sabemos de un billete ajeno. `undefined` = nunca lo hemos mirado. */
export function readSlotCheck(ledger: Ledger, slot: string): SlotCheck | undefined {
  return ledger.slotChecks?.[slot];
}

export async function writeSlotCheck(slot: string, funded: boolean): Promise<Ledger> {
  return updateLedger((l) => ({
    ...l,
    slotChecks: { ...(l.slotChecks ?? {}), [slot]: { funded, at: new Date().toISOString() } },
  }));
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
  /** Locked in the `foreign` and `broken` ones, minor units. A string: this is JSON. */
  unspendable: string;
  /**
   * Los atrapados, con lo justo para poder rescatarlos.
   *
   * No son `slots`, y la distincion importa: un billete que este movil no puede firmar
   * jamas debe entrar en la lista de lo gastable, porque seria ofrecer para pagar un
   * dinero que no se puede mover. Pero para llamar a `reclaim` hace falta su indice, y
   * sin esto habria que volver a leer la cadena solo para averiguarlo.
   */
  stuck?: StuckNote[];
}

export interface StuckNote {
  index: number;
  /** Unidades minimas, como string. Esto es JSON. */
  amount: string;
  /** `foreign`: es de una clave de dispositivo anterior. `broken`: su nonce no sirve. */
  reason: 'foreign' | 'broken';
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
  const report: SyncReport = { spendable: 0, foreign: 0, broken: 0, unspendable: '0', stuck: [] };
  let unspendable = 0n;
  const local = new Map(
    ledger.slots.filter((s) => s.owner === owner).map((s) => [s.nonceAccount, s]),
  );

  const fromChain: CachedSlot[] = [];
  for (const c of chain) {
    if (c.authorizedSigner.toBase58() !== deviceKey) {
      report.foreign++;
      unspendable += c.amount;
      report.stuck!.push({ index: c.index, amount: c.amount.toString(), reason: 'foreign' });
      continue;
    }
    if (!c.nonceValue || !c.nonceAuthorityMatches) {
      report.broken++;
      unspendable += c.amount;
      report.stuck!.push({ index: c.index, amount: c.amount.toString(), reason: 'broken' });
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

  report.unspendable = unspendable.toString();

  return {
    ledger: {
      ...ledger,
      ownerPubkey: owner,
      lastSyncAt: now,
      lastSyncReport: report,
      slots: [
        ...ledger.slots.filter((s) => s.owner !== owner),
        ...fromChain,
        ...closed,
      ],
    },
    report,
  };
}
