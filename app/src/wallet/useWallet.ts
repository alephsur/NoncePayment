/**
 * The wallet, as the UI needs to see it.
 *
 * Scope, and it is deliberate: MWA is used ONLINE ONLY, to fund banknotes. It is never
 * on the offline payment path. That decision is what removes the project's biggest
 * technical risk — needing a third-party wallet app to sign in airplane mode. See
 * docs/ARCHITECTURE.md §4.
 *
 * So this hook does three things and no more: prove who the owner is, show what they
 * hold, and keep the authorisation alive between runs.
 */
import { useCallback, useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { USDC_MINT_DEVNET } from '@noncepayment/sdk';

import { connection } from '../net/settlement';
import { readSession, writeSession, clearSession, WalletSession } from '../store/walletSession';
import { connectWallet, reconnectWallet } from './mwa';

export type WalletStatus =
  /** Never connected, or the user disconnected. */
  | 'disconnected'
  /** A wallet dialog is open, or we are renewing the token. */
  | 'connecting'
  /** Authorised and usable. */
  | 'connected'
  /**
   * We know the address from a previous run but the token could not be renewed.
   * The balance still renders; funding will ask for approval again.
   */
  | 'stale';

export interface Balances {
  /** USDC in minor units. `null` means "not read yet", 0n means "read, and empty". */
  usdc: bigint | null;
  /** Whether the owner even has a USDC token account yet. */
  hasUsdcAccount: boolean;
}

export interface WalletState {
  status: WalletStatus;
  session: WalletSession | null;
  balances: Balances;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useWallet(online: boolean): WalletState {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [status, setStatus] = useState<WalletStatus>('disconnected');
  const [balances, setBalances] = useState<Balances>({ usdc: null, hasUsdcAccount: false });
  const [error, setError] = useState<string | null>(null);

  const readBalances = useCallback(async (owner: PublicKey) => {
    if (!online) return;
    const ata = getAssociatedTokenAddressSync(USDC_MINT_DEVNET, owner);
    try {
      const account = await getAccount(connection(), ata, 'confirmed');
      setBalances({ usdc: account.amount, hasUsdcAccount: true });
    } catch {
      // No token account is the normal state for a fresh wallet, not an error: it gets
      // created the first time somebody sends them USDC.
      setBalances({ usdc: 0n, hasUsdcAccount: false });
    }
  }, [online]);

  /** On launch: show the stored account immediately, then renew the token quietly. */
  useEffect(() => {
    (async () => {
      const stored = await readSession();
      if (!stored) return;

      setSession(stored);
      setStatus('stale');
      readBalances(stored.publicKey);

      if (!online) return;
      try {
        const fresh = await reconnectWallet(stored.authToken);
        const saved = await writeSession(fresh);
        setSession(saved);
        setStatus('connected');
        readBalances(saved.publicKey);
      } catch {
        // The token expired or the wallet revoked us. Not worth a scary message —
        // the address is still right, and connect() will ask for approval again.
        setStatus('stale');
      }
    })();
  }, [online, readBalances]);

  const connect = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      const fresh = await connectWallet();
      const saved = await writeSession(fresh);
      setSession(saved);
      setStatus('connected');
      await readBalances(saved.publicKey);
    } catch (e: any) {
      setStatus(session ? 'stale' : 'disconnected');
      setError(explain(e));
    }
  }, [readBalances, session]);

  const disconnect = useCallback(async () => {
    await clearSession();
    setSession(null);
    setStatus('disconnected');
    setBalances({ usdc: null, hasUsdcAccount: false });
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (session) await readBalances(session.publicKey);
  }, [session, readBalances]);

  return { status, session, balances, error, connect, disconnect, refresh };
}

/**
 * MWA errors arrive as opaque native strings. Turn the ones a user can act on into
 * something that says what to do; anything else keeps its original text, because a
 * vague message is worse than an ugly one when you are debugging on a phone.
 */
export function explain(e: any): string {
  const raw = String(e?.message ?? e);
  if (/no.*wallet|not.*installed|ActivityNotFound|NoWalletFound/i.test(raw)) {
    return 'No hay ninguna wallet compatible instalada. Instala Phantom, Solflare o usa Seed Vault.';
  }
  if (/cancel|declin|reject|denied/i.test(raw)) {
    return 'Has cancelado la autorizacion.';
  }
  if (/cluster|chain|network/i.test(raw)) {
    return 'La wallet no esta en devnet. Cambia de red en la wallet y vuelve a intentarlo.';
  }
  return raw;
}
