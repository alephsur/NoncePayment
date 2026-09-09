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
 * Firma y envia las transacciones de carga de billetes. ONLINE.
 *
 * Nota: los keypairs de los nonce accounts tienen que firmar tambien. Se firman
 * localmente ANTES de pasar la transaccion a la wallet (firma parcial).
 */
export async function signAndSendTransactions(
  authToken: string,
  transactions: Transaction[],
): Promise<string[]> {
  return transact(async (wallet: Web3MobileWallet) => {
    await wallet.reauthorize({ auth_token: authToken, identity: APP_IDENTITY });
    return wallet.signAndSendTransactions({ transactions });
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
