/**
 * Loading banknotes (ONLINE), and reading them back.
 *
 * The only moment the user's real wallet is involved. After this, the device key can
 * spend with no network and no wallet app.
 *
 * The chain is the record, the ledger is a cache. So a load does not write down what it
 * meant to create: it sends, waits for confirmation, and then syncs from chain. The same
 * sync runs when the app opens, which is what makes a crash between "the wallet sent it"
 * and "the app wrote it down" harmless — the banknotes turn up on the next launch.
 */
import { PublicKey } from '@solana/web3.js';
import {
  NOTES_PER_TRANSACTION,
  USDC_MINT_DEVNET,
  buildLoadTransactions,
  deviceKeyTopUpLamports,
  estimateNoteRentLamports,
  fetchOwnerSlots,
  findFreeSlotIndexes,
  nonceRentLamports,
} from '@noncepayment/sdk';

import { connection } from './settlement';
import { Ledger, SyncReport, mergeChainSlots, readLedger, writeLedger } from '../store/ledger';
import { readSession, writeSession } from '../store/walletSession';
import { signAndSendWithWallet } from '../wallet/mwa';

/** The mint banknotes are loaded in. One place to change it. */
export const LOAD_MINT = USDC_MINT_DEVNET;

/** Caps one load. Keeps the wallet's approval sheet readable and one failure small. */
export const MAX_NOTES_PER_LOAD = 8;

export type LoadStep = 'preparing' | 'wallet' | 'confirming' | 'syncing';

export interface LoadResult {
  signatures: string[];
  ledger: Ledger;
  report: SyncReport;
}

/** Re-reads every banknote of `owner` from chain and folds it into the ledger. */
export async function syncLedgerWithChain(
  owner: PublicKey,
  deviceKey: PublicKey,
): Promise<{ ledger: Ledger; report: SyncReport }> {
  const chain = await fetchOwnerSlots(connection(), owner);
  const merged = mergeChainSlots(
    await readLedger(),
    chain,
    owner.toBase58(),
    deviceKey.toBase58(),
  );
  await writeLedger(merged.ledger);
  return merged;
}

export interface LoadCost {
  /** Rent locked per banknote: nonce + slot + vault. Returned when the note closes. */
  rentPerNoteLamports: number;
  /** SOL sent to the device key so it can pay voucher fees. Zero if it has enough. */
  deviceKeyTopUpLamports: number;
}

export async function estimateLoadCost(deviceKey: PublicKey): Promise<LoadCost> {
  const conn = connection();
  const [rentPerNoteLamports, topUp] = await Promise.all([
    estimateNoteRentLamports(conn),
    deviceKeyTopUpLamports(conn, deviceKey),
  ]);
  return { rentPerNoteLamports, deviceKeyTopUpLamports: topUp };
}

/**
 * Loads one banknote per entry of `amounts` (minor units), in one wallet approval.
 *
 * Throws on anything that leaves the load incomplete. Even then, whatever did land is
 * on chain and the next sync will pick it up.
 */
export async function loadNotes(params: {
  deviceKey: PublicKey;
  amounts: bigint[];
  onStep?: (step: LoadStep) => void;
}): Promise<LoadResult> {
  const { deviceKey, amounts, onStep } = params;
  if (amounts.length === 0) throw new Error('Elige al menos un billete');
  if (amounts.length > MAX_NOTES_PER_LOAD) {
    throw new Error(`Como mucho ${MAX_NOTES_PER_LOAD} billetes por carga`);
  }

  const conn = connection();
  let lastValidBlockHeight = 0;
  let blockhash = '';
  let owner: PublicKey | null = null;

  // The stored token, not the one the UI loaded at launch: a reauthorize since then may
  // have replaced it, and the old one would cost the user an extra approval.
  const stored = await readSession();

  onStep?.('wallet');
  const { signatures, session } = await signAndSendWithWallet(
    stored?.authToken ?? null,
    async (walletOwner) => {
      onStep?.('preparing');
      owner = walletOwner;

      // Indexes the phone already holds count as taken even if the chain does not show
      // them yet: a load from a moment ago may still be below `confirmed`.
      const local = (await readLedger()).slots
        .filter((s) => s.owner === walletOwner.toBase58())
        .filter((s) => s.status === 'available' || s.status === 'spent_pending_settlement')
        .map((s) => s.index);

      const [indexes, topUp, nonceRent, latest] = await Promise.all([
        findFreeSlotIndexes(conn, walletOwner, amounts.length, local),
        deviceKeyTopUpLamports(conn, deviceKey),
        nonceRentLamports(conn),
        conn.getLatestBlockhash('confirmed'),
      ]);
      blockhash = latest.blockhash;
      lastValidBlockHeight = latest.lastValidBlockHeight;

      const { transactions } = buildLoadTransactions({
        owner: walletOwner,
        authorizedSigner: deviceKey,
        mint: LOAD_MINT,
        notes: amounts.map((amount, i) => ({ index: indexes[i], amount })),
        recentBlockhash: blockhash,
        nonceRentLamports: nonceRent,
        deviceKeyTopUpLamports: topUp,
      });
      onStep?.('wallet');
      return transactions;
    },
  );

  // The wallet may have handed back a renewed token. Keep it, or the next launch asks
  // for approval again.
  await writeSession(session);

  onStep?.('confirming');
  const outcomes = await Promise.allSettled(
    signatures.map((signature) =>
      conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed'),
    ),
  );
  const failed = outcomes.flatMap((o, i) => {
    if (o.status === 'rejected') return [`${signatures[i].slice(0, 8)}…: ${o.reason?.message ?? o.reason}`];
    if (o.value.value.err) return [`${signatures[i].slice(0, 8)}…: ${JSON.stringify(o.value.value.err)}`];
    return [];
  });

  onStep?.('syncing');
  const { ledger, report } = await syncLedgerWithChain(owner!, deviceKey);

  if (failed.length > 0) {
    const lost = failed.length * NOTES_PER_TRANSACTION;
    throw new Error(
      `${failed.length} de ${signatures.length} transacciones no se confirmaron ` +
        `(hasta ${lost} billetes). Lo que si llego ya esta en tu lista.\n${failed.join('\n')}`,
    );
  }

  return { signatures, ledger, report };
}
