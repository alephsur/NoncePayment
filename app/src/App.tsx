import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';

import { useDeviceKey } from './store/useDeviceKey';
import { readLedger, offlineBalance, Ledger } from './store/ledger';
import { registerSettlementTask, drainSettlementQueue, isOnline } from './net/settlement';
import { syncLedgerWithChain } from './net/loading';
import { HomeScreen } from './screens/HomeScreen';
import { useWallet } from './wallet/useWallet';
import { theme } from './ui/theme';

export default function App() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const deviceKey = useDeviceKey();
  const wallet = useWallet(online);

  const owner = wallet.session?.publicKey.toBase58() ?? null;
  const self = deviceKey.identity?.publicKey.toBase58() ?? null;

  // Held in a ref rather than a dependency: the wallet hands back a new session object
  // on every reauthorise, and letting that churn into `refresh` would cost a chain read
  // each time.
  const refreshWallet = useRef(wallet.refresh);
  refreshWallet.current = wallet.refresh;

  /**
   * Everything the home screen shows, brought up to date in one go: whether there is
   * network, the banknotes — from chain if we can reach it, from the cache if not — and
   * the wallet balance.
   *
   * The cache read at the end is not a fallback for errors only. Offline it IS the
   * answer: those banknotes are exactly what the phone can still spend.
   */
  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const nowOnline = await isOnline();
      setOnline(nowOnline);

      if (nowOnline && owner && self) {
        try {
          const synced = await syncLedgerWithChain(new PublicKey(owner), new PublicKey(self));
          setLedger(synced.ledger);
          refreshWallet.current();
          return;
        } catch (e) {
          console.warn('[ledger] sync con la cadena fallido:', e);
        }
      }
      setLedger(await readLedger());
    } finally {
      setSyncing(false);
    }
  }, [owner, self]);

  /** On launch, and again whenever the owner or the device key changes. */
  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * And every time the app comes back to the front.
   *
   * Connectivity used to be read once at launch, so a phone that went into airplane mode
   * — or came out of it — went on showing the wrong half of the app until it was killed
   * and reopened. Which is exactly the gesture the demo is built around.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  /**
   * Settlement needs to know who we are, and that is the device key.
   *
   * So it can only be armed once one exists — on a fresh install that is after the user
   * has been through the setup card, not at launch. Arming it earlier would register a
   * background task that can never identify its own vouchers.
   */
  useEffect(() => {
    const self = deviceKey.identity?.publicKey;
    if (!self) return;

    registerSettlementTask(self);
    // One warm attempt on open: if there is network, settle what is pending now.
    drainSettlementQueue(self)
      .then(async () => setLedger(await readLedger()))
      .catch(() => undefined);
  }, [deviceKey.identity]);

  if (!ledger || deviceKey.phase === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.muted}>Abriendo la cartera...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <HomeScreen
        ledger={ledger}
        deviceKey={deviceKey}
        wallet={wallet}
        online={online}
        balance={offlineBalance(ledger)}
        syncing={syncing}
        onRefresh={refresh}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muted: { color: theme.textMuted, fontSize: 15 },
});
