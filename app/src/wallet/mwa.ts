/**
 * Mobile Wallet Adapter.
 *
 * OJO CON EL ALCANCE: MWA se usa SOLO ONLINE, para financiar billetes. Nunca en el
 * camino de pago offline. Esa decision de arquitectura es deliberada — evita depender
 * de que la app de wallet sepa firmar en modo avion, que era el mayor riesgo tecnico
 * del proyecto. Ver docs/ARCHITECTURE.md §4.
 *
 * El hackathon exige integrar MWA, y aqui se integra de verdad: es lo que custodia el
 * dinero y lo que autoriza a la clave de dispositivo.
 */
import { transact, Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey, Transaction } from '@solana/web3.js';

const APP_IDENTITY = {
  name: 'NoncePayment',
  uri: 'https://noncepayment.app',
  icon: 'favicon.ico',
};

const CHAIN = 'solana:devnet';

export interface WalletSession {
  publicKey: PublicKey;
  authToken: string;
  label?: string;
}

export async function connectWallet(): Promise<WalletSession> {
  return transact(async (wallet: Web3MobileWallet) => {
    const auth = await wallet.authorize({
      chain: CHAIN,
      identity: APP_IDENTITY,
    });
    const account = auth.accounts[0];
    return {
      publicKey: new PublicKey(toBytes(account.address)),
      authToken: auth.auth_token,
      label: account.label,
    };
  });
}

/** Reconecta con el token guardado, sin volver a molestar al usuario. */
export async function reconnectWallet(authToken: string): Promise<WalletSession> {
  return transact(async (wallet: Web3MobileWallet) => {
    const auth = await wallet.reauthorize({
      auth_token: authToken,
      identity: APP_IDENTITY,
    });
    const account = auth.accounts[0];
    return {
      publicKey: new PublicKey(toBytes(account.address)),
      authToken: auth.auth_token,
      label: account.label,
    };
  });
}

/**
 * Opens the wallet once, builds the transactions inside that session, and has the
 * wallet sign and send them. ONLINE.
 *
 * `build` runs after the wallet has authorised, not before, for two reasons. The
 * transactions carry a recent blockhash that expires in about a minute, and the user may
 * sit on the approval sheet for a while — so it is fetched as late as possible. And the
 * account the wallet returns is the one that will sign: building against a stored
 * address that the user has since switched away from would produce transactions the
 * wallet cannot sign.
 *
 * A stale token falls back to a full authorize in the same session, so an expired
 * authorisation costs the user one extra tap instead of an error.
 */
export async function signAndSendWithWallet(
  authToken: string | null,
  build: (owner: PublicKey) => Promise<Transaction[]>,
): Promise<{ signatures: string[]; session: WalletSession }> {
  return transact(async (wallet: Web3MobileWallet) => {
    let auth;
    try {
      if (!authToken) throw new Error('no token');
      auth = await wallet.reauthorize({ auth_token: authToken, identity: APP_IDENTITY });
    } catch {
      auth = await wallet.authorize({ chain: CHAIN, identity: APP_IDENTITY });
    }

    const account = auth.accounts[0];
    const session: WalletSession = {
      publicKey: new PublicKey(toBytes(account.address)),
      authToken: auth.auth_token,
      label: account.label,
    };

    const transactions = await build(session.publicKey);
    const signatures = await wallet.signAndSendTransactions({ transactions });
    return { signatures, session };
  });
}

/**
 * Igual que `signAndSendWithWallet`, pero la wallet SOLO FIRMA: enviamos nosotros.
 *
 * Dos razones, y las dos salieron de una retirada que no funcionaba.
 *
 * `signAndSendTransactions` es opcional en MWA — hay wallets que solo implementan
 * `signTransactions` — y cuando falta, la asociacion se cae con un error nativo que no
 * explica nada. Y, mas importante: cuando envia la wallet, envia por SU RPC y a SU red.
 * Nosotros sabemos a que cluster va esto; la wallet puede estar mirando otro.
 *
 * Enviarlo nosotros nos devuelve tambien el control de los reintentos y de la
 * confirmacion, que es justo lo que hace falta cuando algo no llega.
 */
export async function signWithWallet(
  authToken: string | null,
  build: (owner: PublicKey) => Promise<Transaction[]>,
): Promise<{ signed: Transaction[]; session: WalletSession }> {
  return transact(async (wallet: Web3MobileWallet) => {
    let auth;
    try {
      if (!authToken) throw new Error('no token');
      auth = await wallet.reauthorize({ auth_token: authToken, identity: APP_IDENTITY });
    } catch {
      auth = await wallet.authorize({ chain: CHAIN, identity: APP_IDENTITY });
    }

    const account = auth.accounts[0];
    const session: WalletSession = {
      publicKey: new PublicKey(toBytes(account.address)),
      authToken: auth.auth_token,
      label: account.label,
    };

    const transactions = await build(session.publicKey);
    const signed = await wallet.signTransactions({ transactions });
    return { signed, session };
  });
}

function toBytes(base64Address: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64Address, 'base64'));
}

/**
 * Detecta si estamos en un Seeker. Da puntos de "Mobile UX" y desbloquea el guiño de
 * Seed Vault en la UI.
 * @see https://docs.solanamobile.com/recipes/detecting-seeker-users
 */
export async function isSeekerDevice(): Promise<boolean> {
  try {
    const { getSeekerGenesisToken } = require('@solana-mobile/seeker-utils');
    return Boolean(await getSeekerGenesisToken());
  } catch {
    return false;
  }
}
