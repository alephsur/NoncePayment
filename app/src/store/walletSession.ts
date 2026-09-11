/**
 * The Mobile Wallet Adapter session, kept across app restarts.
 *
 * MWA hands back an `auth_token` when the user first approves the app. Storing it is
 * what makes every later connection silent: `reauthorize` renews it without the wallet
 * asking the user anything. Losing it isn't dangerous, it just means one more approval
 * dialog — so the failure mode here is always "ask again", never "give up".
 *
 * It goes in the secure store, not the ledger, because it authorises actions on the
 * user's real wallet. The public key sits alongside it so the UI can render the account
 * with no network and no wallet round-trip — worth it, because the app has to be usable
 * with no coverage at all.
 */
import * as SecureStore from 'expo-secure-store';
import { PublicKey } from '@solana/web3.js';

const SESSION_SLOT = 'noncepay.wallet_session.v1';

export interface StoredSession {
  authToken: string;
  pubkey: string;
  label?: string;
  /** ISO 8601. Only for display — MWA never tells us when a token expires. */
  authorizedAt: string;
}

export interface WalletSession {
  authToken: string;
  publicKey: PublicKey;
  label?: string;
  authorizedAt: string;
}

export async function readSession(): Promise<WalletSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_SLOT, {
      requireAuthentication: false,
    });
    if (!raw) return null;
    const stored: StoredSession = JSON.parse(raw);
    return { ...stored, publicKey: new PublicKey(stored.pubkey) };
  } catch {
    // Corrupt or unreadable: treat it as no session. The user re-approves, which is
    // an inconvenience, not a loss — the money lives on chain, not in this token.
    return null;
  }
}

export async function writeSession(session: {
  authToken: string;
  publicKey: PublicKey;
  label?: string;
}): Promise<WalletSession> {
  const stored: StoredSession = {
    authToken: session.authToken,
    pubkey: session.publicKey.toBase58(),
    label: session.label,
    authorizedAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(SESSION_SLOT, JSON.stringify(stored), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  });
  return { ...stored, publicKey: session.publicKey };
}

/** Forgets the wallet. Loaded banknotes are untouched — they live on chain. */
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_SLOT);
}
