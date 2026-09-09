/**
 * Cola de liquidacion.
 *
 * Todo voucher recibido offline se guarda y se reintenta en cuanto vuelve la red. Esto
 * no es solo comodidad: cada minuto que un voucher pasa sin liquidar es un minuto de
 * ventana de riesgo de doble gasto, asi que cerrarla rapido es una medida de seguridad.
 * Ver docs/THREAT-MODEL.md §3.
 */
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { Connection, PublicKey } from '@solana/web3.js';
import { settleVoucher, verifyVoucher } from '@noncepayment/sdk';
import { readLedger, updateLedger, PendingVoucher } from '../store/ledger';

export const SETTLEMENT_TASK = 'noncepay.settlement.v1';
const RPC_URL = 'https://api.devnet.solana.com';
const MAX_ATTEMPTS = 10;

export function connection(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

export async function isOnline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

/** Intenta liquidar todo lo pendiente. Idempotente y seguro de llamar a menudo. */
export async function drainSettlementQueue(
  self: PublicKey,
): Promise<{ settled: number; failed: number }> {
  if (!(await isOnline())) return { settled: 0, failed: 0 };

  const ledger = await readLedger();
  const conn = connection();
  let settled = 0;
  let failed = 0;

  for (const item of ledger.pending) {
    if (item.settledSignature || item.attempts >= MAX_ATTEMPTS) continue;

    try {
      const verified = verifyVoucher(item.envelope, self);
      const result = await settleVoucher(conn, verified);
      item.settledSignature = result.signature;
      item.lastError = undefined;
      settled++;
    } catch (e: any) {
      item.attempts += 1;
      item.lastError = String(e?.message ?? e);
      failed++;
    }
  }

  await updateLedger((l) => ({ ...l, pending: ledger.pending }));
  return { settled, failed };
}

export async function enqueueVoucher(item: PendingVoucher): Promise<void> {
  await updateLedger((l) => ({ ...l, pending: [...l.pending, item] }));
}

/**
 * Registra la tarea en segundo plano.
 *
 * Es lo que hace que el dinero "aparezca solo" al recuperar cobertura, sin abrir la
 * app. Es un detalle de UX nativo imposible en web, y por tanto puntua.
 */
export function registerSettlementTask(self: PublicKey): void {
  if (!TaskManager.isTaskDefined(SETTLEMENT_TASK)) {
    TaskManager.defineTask(SETTLEMENT_TASK, async () => {
      try {
        const { settled } = await drainSettlementQueue(self);
        return settled > 0
          ? BackgroundFetch.BackgroundFetchResult.NewData
          : BackgroundFetch.BackgroundFetchResult.NoData;
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });
  }

  BackgroundFetch.registerTaskAsync(SETTLEMENT_TASK, {
    minimumInterval: 60,
    stopOnTerminate: false,
    startOnBoot: true,
  }).catch(() => undefined);
}
