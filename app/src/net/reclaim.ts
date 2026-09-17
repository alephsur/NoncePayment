/**
 * Rescate de billetes atrapados. ONLINE, y solo con la wallet real.
 *
 * Un billete nombra a una clave de dispositivo concreta, y solo esa puede firmarlo.
 * Cuando esa clave deja de existir — Android la destruye al cambiar la huella, una
 * reinstalacion, un movil nuevo — el dinero sigue bloqueado en su vault sin nadie capaz
 * de gastarlo. `reclaim` lo devuelve al dueño, y lo firma su wallet.
 *
 * Es la contrapartida del diseño entero: delegar en una clave del telefono es lo que
 * permite pagar sin cobertura, y esto es lo que impide que esa delegacion se convierta
 * en una manera de perder dinero para siempre.
 *
 * La wallet FIRMA y enviamos nosotros, por lo mismo que en la retirada: enviar por el
 * RPC de la wallet significa enviar a la red que ella tenga puesta, y nosotros sabemos
 * a cual va esto.
 */
import { PublicKey } from '@solana/web3.js';
import { buildReclaimTransactions } from '@noncepayment/sdk';

import { LOAD_MINT, syncLedgerWithChain } from './loading';
import { connection } from './settlement';
import { readSession, writeSession } from '../store/walletSession';
import { signWithWallet } from '../wallet/mwa';

export type ReclaimStep = 'wallet' | 'sending' | 'confirming' | 'syncing';

export interface ReclaimResult {
  signatures: string[];
  recovered: number;
}

export async function reclaimNotes(params: {
  deviceKey: PublicKey;
  indexes: number[];
  onStep?: (step: ReclaimStep) => void;
}): Promise<ReclaimResult> {
  const { deviceKey, indexes, onStep } = params;
  if (indexes.length === 0) throw new Error('No hay nada que recuperar');

  const conn = connection();
  const stored = await readSession();
  let blockhash = '';
  let lastValidBlockHeight = 0;
  let owner: PublicKey | null = null;

  onStep?.('wallet');
  const { signed, session } = await signWithWallet(stored?.authToken ?? null, async (walletOwner) => {
    owner = walletOwner;
    const latest = await conn.getLatestBlockhash('confirmed');
    blockhash = latest.blockhash;
    lastValidBlockHeight = latest.lastValidBlockHeight;
    return buildReclaimTransactions({
      owner: walletOwner,
      mint: LOAD_MINT,
      indexes,
      recentBlockhash: blockhash,
    });
  });
  await writeSession(session);

  onStep?.('sending');
  const signatures: string[] = [];
  for (const tx of signed) {
    signatures.push(
      await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 }),
    );
  }

  onStep?.('confirming');
  const outcomes = await Promise.allSettled(
    signatures.map((signature) =>
      conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed'),
    ),
  );

  // La sincronizacion va ANTES de lanzar cualquier error, igual que en la carga: lo que
  // si se recupero ya esta en la cadena, y el usuario tiene derecho a verlo aunque una
  // de las transacciones se haya quedado por el camino.
  onStep?.('syncing');
  const { report } = await syncLedgerWithChain(owner!, deviceKey);

  const failed = outcomes.flatMap((o, i) =>
    o.status === 'rejected' || o.value.value.err ? [signatures[i].slice(0, 8)] : [],
  );
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} de ${signatures.length} transacciones no se confirmaron. ` +
        `Lo que si se recupero ya esta en tu wallet; vuelve a intentarlo con el resto.`,
    );
  }

  return { signatures, recovered: indexes.length - (report.foreign + report.broken) };
}
