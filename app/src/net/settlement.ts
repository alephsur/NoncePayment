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
import { readDeviceKeyIdentity } from '../store/deviceKey';
import { readSession } from '../store/walletSession';

export const SETTLEMENT_TASK = 'noncepay.settlement.v1';

/**
 * El nonce del billete ya avanzo: este voucher esta muerto y lo estara siempre.
 *
 * Es la garantia del proyecto vista desde dentro. Avanzar un nonce invalida cualquier
 * otra transaccion firmada contra el valor anterior, asi que un billete se cobra una vez
 * y solo una. Cuando la red contesta esto, no hay nada que reintentar.
 *
 * Lo que significa depende de quien lo recibe, y la diferencia es el producto entero:
 * para quien PAGO, que ese billete ya se cobro — normal si hubo reintentos del gesto.
 * Para quien COBRA, que el pagador ya lo habia gastado con otro: eso es un doble gasto
 * intentado contra el, y merece decirse con esas palabras.
 */
function nonceAlreadyUsed(message: string): boolean {
  return /blockhash not found|nonce/i.test(message);
}
const RPC_URL = 'https://api.devnet.solana.com';
const MAX_ATTEMPTS = 10;

export function connection(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

export async function isOnline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

/**
 * Las direcciones a las que este movil puede cobrar.
 *
 * Dos, y en este orden: la wallet del usuario cuando hay una conectada — que es la que
 * se ofrece al cobrar, porque el dinero aterriza donde se puede gastar — y la clave de
 * dispositivo, que existe siempre y es lo unico que hay cuando no hay wallet.
 *
 * Se leen aqui, cada vez, en lugar de recibirlas como argumento. La tarea de fondo vive
 * mas que cualquier pantalla: capturar una identidad al registrarla significaba que
 * conectar una wallet despues dejaba a la tarea liquidando contra una lista incompleta,
 * sin que nada lo dijera. Ninguna de las dos lecturas pide biometria ni red.
 */
export async function selfIdentities(): Promise<PublicKey[]> {
  const [key, session] = await Promise.all([readDeviceKeyIdentity(), readSession()]);
  const out: PublicKey[] = [];
  if (session) out.push(session.publicKey);
  if (key) out.push(key.publicKey);
  return out;
}

/** Intenta liquidar todo lo pendiente. Idempotente y seguro de llamar a menudo. */
export async function drainSettlementQueue(): Promise<{ settled: number; failed: number }> {
  if (!(await isOnline())) return { settled: 0, failed: 0 };

  const identities = await selfIdentities();
  const ledger = await readLedger();
  const conn = connection();
  let settled = 0;
  let failed = 0;

  for (const item of ledger.pending) {
    if (item.settledSignature || item.attempts >= MAX_ATTEMPTS) continue;

    try {
      // Contra quien se verifica depende de quien lo tiene.
      //
      // Un voucher RECIBIDO se comprueba contra nuestra clave, y esa es la comprobacion
      // de seguridad: que va dirigido a mi y no a otro. Uno ENVIADO va dirigido, por
      // definicion, a otra persona — comprobarlo contra nuestra clave falla siempre.
      //
      // Estaba comprobandose siempre contra la nuestra, asi que el pagador NUNCA podia
      // liquidar sus propios pagos: diez intentos, diez «no a mi», y a rendirse. El
      // dinero solo se movia si el receptor salia a la red, cuando la promesa del
      // proyecto es que basta con que lo haga cualquiera de los dos. Encontrado con
      // cinco billetes dados por gastados en el movil y todavia abiertos en cadena.
      const expected =
        item.direction === 'received'
          ? identities.find((k) => k.toBase58() === item.envelope.hint.recipient)
          : new PublicKey(item.envelope.hint.recipient);
      if (!expected) {
        throw new Error(
          'Este cobro va a una direccion que este movil ya no controla. Vuelve a ' +
            'conectar la wallet con la que lo cobraste.',
        );
      }
      const verified = verifyVoucher(item.envelope, expected);
      const result = await settleVoucher(conn, verified);
      item.settledSignature = result.signature;
      item.lastError = undefined;
      settled++;
    } catch (e: any) {
      const message = String(e?.message ?? e);
      if (nonceAlreadyUsed(message)) {
        // Muerto, no fallido: reintentarlo diez veces solo gasta bateria y esconde lo
        // que de verdad ha pasado.
        item.attempts = MAX_ATTEMPTS;
        item.lastError =
          item.direction === 'received'
            ? 'DOBLE GASTO: el pagador ya habia gastado este billete en otro pago. Este cobro no se puede cobrar.'
            : 'Este billete ya se cobro con otro pago. No hace falta hacer nada.';
      } else {
        item.attempts += 1;
        item.lastError = message;
      }
      failed++;
    }
  }

  await updateLedger((l) => ({ ...l, pending: ledger.pending }));
  return { settled, failed };
}

export async function enqueueVoucher(item: PendingVoucher): Promise<void> {
  await updateLedger((l) => ({ ...l, pending: [...l.pending, item] }));
}

/** Vouchers que agotaron sus intentos y ya no se reintentan solos. Dinero en el limbo. */
export function abandonedVouchers(pending: PendingVoucher[]): PendingVoucher[] {
  return pending.filter((p) => !p.settledSignature && p.attempts >= MAX_ATTEMPTS);
}

/**
 * Devuelve al ruedo lo que se habia rendido, y lo intenta otra vez.
 *
 * Rendirse tras diez intentos protege de reintentar para siempre algo irrecuperable,
 * pero convierte cualquier fallo prolongado — un bug, una semana sin cobertura — en
 * dinero parado sin salida. Mientras el billete siga abierto en cadena el voucher sigue
 * siendo bueno, asi que tiene que haber una manera de decir «vuelve a intentarlo».
 */
export async function retrySettlement(): Promise<{ settled: number; failed: number }> {
  await updateLedger((l) => ({
    ...l,
    pending: l.pending.map((p) =>
      p.settledSignature ? p : { ...p, attempts: 0, lastError: undefined },
    ),
  }));
  return drainSettlementQueue();
}

/**
 * Registra la tarea en segundo plano.
 *
 * Es lo que hace que el dinero "aparezca solo" al recuperar cobertura, sin abrir la
 * app. Es un detalle de UX nativo imposible en web, y por tanto puntua.
 */
export function registerSettlementTask(): void {
  if (!TaskManager.isTaskDefined(SETTLEMENT_TASK)) {
    TaskManager.defineTask(SETTLEMENT_TASK, async () => {
      try {
        const { settled } = await drainSettlementQueue();
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
