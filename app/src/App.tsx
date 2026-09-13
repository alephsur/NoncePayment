import React, { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { useDeviceKey } from './store/useDeviceKey';
import { readLedger, offlineBalance, Ledger } from './store/ledger';
import { registerSettlementTask, drainSettlementQueue, isOnline } from './net/settlement';
import { HomeScreen } from './screens/HomeScreen';
import { useWallet } from './wallet/useWallet';
import { theme } from './ui/theme';

export default function App() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [online, setOnline] = useState(false);
  const deviceKey = useDeviceKey();
  const wallet = useWallet(online);

  useEffect(() => {
    (async () => {
      setLedger(await readLedger());
      setOnline(await isOnline());
    })();
  }, []);

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
        onRefresh={async () => setLedger(await readLedger())}
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
