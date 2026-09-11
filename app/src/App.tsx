import React, { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';

import { ensureDeviceKey } from './store/deviceKey';
import { readLedger, offlineBalance, Ledger } from './store/ledger';
import { registerSettlementTask, drainSettlementQueue, isOnline } from './net/settlement';
import { HomeScreen } from './screens/HomeScreen';
import { useWallet } from './wallet/useWallet';
import { theme } from './ui/theme';

export default function App() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [deviceKey, setDeviceKey] = useState<PublicKey | null>(null);
  const [online, setOnline] = useState(false);
  const wallet = useWallet(online);

  useEffect(() => {
    (async () => {
      const kp = await ensureDeviceKey();
      setDeviceKey(kp.publicKey);
      setLedger(await readLedger());
      setOnline(await isOnline());
      registerSettlementTask(kp.publicKey);
      // Un intento en caliente al abrir: si hay red, liquida lo pendiente ya.
      drainSettlementQueue(kp.publicKey)
        .then(async () => setLedger(await readLedger()))
        .catch(() => undefined);
    })();
  }, []);

  if (!ledger || !deviceKey) {
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
