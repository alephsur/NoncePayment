/**
 * Retirada del USDC cobrado, a la wallet del usuario. ONLINE.
 *
 * Dos firmas en una transaccion: la clave de dispositivo autoriza el movimiento de sus
 * tokens y la wallet paga el fee. Ver packages/sdk/src/withdraw.ts para por que el fee
 * no lo paga la clave de dispositivo.
 *
 * El orden de los dos permisos no es casual. La huella se pide ANTES de abrir la wallet:
 * si se pidiera dentro de la sesion MWA, el aviso del sistema saldria encima de la app de
 * la wallet, que es donde el usuario menos espera que le pregunten por su huella.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { USDC_DECIMALS, buildWithdrawTransaction } from '@noncepayment/sdk';

import { LOAD_MINT, syncLedgerWithChain } from './loading';
import { connection } from './settlement';
import { readSession, writeSession } from '../store/walletSession';
import { signAndSendWithWallet } from '../wallet/mwa';

export type WithdrawStep = 'wallet' | 'confirming' | 'syncing';

export async function withdrawReceived(params: {
  /** Ya desbloqueada: la biometria se pide fuera de aqui. */
  signer: Keypair;
  amount: bigint;
  onStep?: (step: WithdrawStep) => void;
}): Promise<{ signature: string; wallet: PublicKey }> {
  const { signer, amount, onStep } = params;
  const conn = connection();
  const stored = await readSession();

  let blockhash = '';
  let lastValidBlockHeight = 0;
  let wallet: PublicKey | null = null;

  onStep?.('wallet');
  const { signatures, session } = await signAndSendWithWallet(
    stored?.authToken ?? null,
    async (walletOwner) => {
      wallet = walletOwner;
      const latest = await conn.getLatestBlockhash('confirmed');
      blockhash = latest.blockhash;
      lastValidBlockHeight = latest.lastValidBlockHeight;

      const tx = buildWithdrawTransaction({
        deviceKey: signer.publicKey,
        wallet: walletOwner,
        mint: LOAD_MINT,
        decimals: USDC_DECIMALS,
        amount,
        recentBlockhash: blockhash,
      });
      // La firma de la clave de dispositivo viaja ya puesta; la wallet solo añade la
      // suya. Si alguna wallet descartara las firmas previas, la red rechazaria la
      // transaccion por firma ausente en vez de mover nada raro.
      tx.partialSign(signer);
      return [tx];
    },
  );
  await writeSession(session);

  onStep?.('confirming');
  const signature = signatures[0];
  const result = await conn.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (result.value.err) {
    throw new Error(`La retirada no se confirmo: ${JSON.stringify(result.value.err)}`);
  }

  onStep?.('syncing');
  await syncLedgerWithChain(wallet!, signer.publicKey);

  return { signature, wallet: wallet! };
}
