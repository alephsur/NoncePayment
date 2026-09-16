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
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { USDC_DECIMALS, buildWithdrawTransaction } from '@noncepayment/sdk';

import { LOAD_MINT, syncLedgerWithChain } from './loading';
import { connection } from './settlement';
import { readSession, writeSession } from '../store/walletSession';
import { signWithWallet } from '../wallet/mwa';

export type WithdrawStep = 'checking' | 'wallet' | 'confirming' | 'syncing';

/** Comision de la transaccion, con holgura. */
const FEE_LAMPORTS = 10_000;
/** Renta de una cuenta de tokens, si la wallet no tiene todavia la de este mint. */
const ATA_RENT_LAMPORTS = 2_100_000;

/**
 * Comprueba que la wallet puede pagar antes de pedirle nada al usuario.
 *
 * Sin esto, una wallet sin SOL produce una firma que jamas se emite, y el error que
 * llega de vuelta es «la transaccion ha caducado» — que describe el sintoma y apunta al
 * sitio equivocado. Costo una prueba entera averiguar que el problema era un saldo a
 * cero. Mejor mirarlo antes, y decirlo.
 */
async function assertWalletCanPay(wallet: PublicKey): Promise<void> {
  const conn = connection();
  const ata = getAssociatedTokenAddressSync(LOAD_MINT, wallet);
  const [lamports, ataInfo] = await Promise.all([
    conn.getBalance(wallet, 'confirmed'),
    conn.getAccountInfo(ata, 'confirmed'),
  ]);

  const needed = FEE_LAMPORTS + (ataInfo ? 0 : ATA_RENT_LAMPORTS);
  if (lamports >= needed) return;

  const sol = (n: number) => (n / LAMPORTS_PER_SOL).toFixed(5);
  throw new Error(
    `Tu wallet no tiene SOL para la comision: hacen falta ${sol(needed)} y tiene ` +
      `${sol(lamports)}. Envia un poco de SOL a ${wallet.toBase58()} y vuelve a ` +
      `intentarlo.` +
      (ataInfo ? '' : ' Incluye la renta de tu cuenta de USDC, que todavia no existe.'),
  );
}

export async function withdrawReceived(params: {
  /** Ya desbloqueada: la biometria se pide fuera de aqui. */
  signer: Keypair;
  amount: bigint;
  onStep?: (step: WithdrawStep) => void;
}): Promise<{ signature: string; wallet: PublicKey }> {
  const { signer, amount, onStep } = params;
  const conn = connection();
  const stored = await readSession();

  // Fuera de la sesion MWA, a proposito.
  //
  // Todo lo que se hace dentro de `transact` corre mientras la wallet espera al otro
  // lado de una asociacion con timeout, y la app esta en segundo plano. Meter aqui dos
  // llamadas RPC — como estaban — es pedirle a esa sesion que aguante la latencia de la
  // red antes de recibir la primera peticion, y lo que vuelve cuando no aguanta es un
  // `CancellationException` que no dice nada de lo que realmente paso. Dentro de la
  // sesion solo queda el blockhash, que tiene que ser lo mas fresco posible.
  if (stored) {
    onStep?.('checking');
    await assertWalletCanPay(stored.publicKey);
  }

  let blockhash = '';
  let lastValidBlockHeight = 0;
  let wallet: PublicKey | null = null;

  onStep?.('wallet');
  const { signed, session } = await signWithWallet(
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
  // Enviamos nosotros, a nuestro RPC. `serialize()` exige todas las firmas, asi que si
  // la wallet hubiera descartado la de la clave de dispositivo, aqui se sabria — y se
  // sabria diciendolo, en vez de con una transaccion que se pierde en otra red.
  const signature = await conn.sendRawTransaction(signed[0].serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  try {
    const result = await conn.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    if (result.value.err) {
      throw new Error(`La retirada no se confirmo: ${JSON.stringify(result.value.err)}`);
    }
  } catch (e) {
    // Expiry is the confirmation giving up, not proof that nothing happened. Ask the
    // chain directly before telling the user their money did not move — the one thing
    // worse than a failed transfer is being told a successful one failed.
    const status = await conn.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const found = status.value[0];
    if (!found || found.err) {
      throw new Error(
        found?.err
          ? `La retirada fallo en la red: ${JSON.stringify(found.err)}`
          : `La retirada no llego a la red. No se ha movido nada; vuelve a intentarlo. (${
              (e as any)?.message ?? e
            })`,
      );
    }
  }

  onStep?.('syncing');
  await syncLedgerWithChain(wallet!, signer.publicKey);

  return { signature, wallet: wallet! };
}
