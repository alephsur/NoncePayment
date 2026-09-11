import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';

import { Ledger, availableNotes } from '../store/ledger';
import { DeviceKeyCard } from '../ui/DeviceKeyCard';
import { WalletCard } from '../ui/WalletCard';
import { formatUsdc, shortKey } from '../ui/format';
import { theme, spacing } from '../ui/theme';
import type { WalletState } from '../wallet/useWallet';
import { PayScreen } from './PayScreen';
import { ReceiveScreen } from './ReceiveScreen';

type Tab = 'home' | 'pay' | 'receive';

interface Props {
  ledger: Ledger;
  deviceKey: PublicKey;
  wallet: WalletState;
  online: boolean;
  balance: bigint;
  onRefresh: () => Promise<void>;
}

export function HomeScreen(props: Props) {
  const [tab, setTab] = useState<Tab>('home');

  if (tab === 'pay') {
    return <PayScreen {...props} onDone={() => { setTab('home'); props.onRefresh(); }} />;
  }
  if (tab === 'receive') {
    return <ReceiveScreen {...props} onDone={() => { setTab('home'); props.onRefresh(); }} />;
  }

  const notes = availableNotes(props.ledger);
  const pending = props.ledger.pending.filter((p) => !p.settledSignature);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.statusRow}>
        <View
          style={[
            styles.dot,
            { backgroundColor: props.online ? theme.accent : theme.warning },
          ]}
        />
        <Text style={styles.statusText}>
          {props.online ? 'Conectado' : 'Sin red — modo efectivo'}
        </Text>
      </View>

      <Text style={styles.label}>Efectivo disponible offline</Text>
      <Text style={styles.balance}>${formatUsdc(props.balance)}</Text>
      <Text style={styles.sub}>
        {notes.length} {notes.length === 1 ? 'billete' : 'billetes'} · dispositivo{' '}
        {shortKey(props.deviceKey.toBase58())}
      </Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.primary]}
          onPress={() => setTab('pay')}
          disabled={notes.length === 0}
        >
          <Text style={styles.primaryText}>Pagar</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={() => setTab('receive')}>
          <Text style={styles.secondaryText}>Cobrar</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Billetes</Text>
      {notes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No tienes billetes cargados. Conectate a internet y carga efectivo para poder
            pagar sin cobertura.
          </Text>
        </View>
      ) : (
        notes.map((n) => (
          <View key={n.index} style={styles.note}>
            <Text style={styles.noteAmount}>${formatUsdc(BigInt(n.amount))}</Text>
            <Text style={styles.noteMeta}>
              #{n.index} · nonce {shortKey(n.nonceAccount)}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.section}>Wallet y recarga</Text>
      <WalletCard wallet={props.wallet} online={props.online} />

      <Text style={styles.section}>Dispositivo</Text>
      <DeviceKeyCard deviceKey={props.deviceKey} online={props.online} />

      {pending.length > 0 && (
        <>
          <Text style={styles.section}>Pendiente de liquidar</Text>
          {pending.map((p, i) => (
            <View key={i} style={[styles.note, styles.notePending]}>
              <Text style={styles.noteAmount}>
                ${formatUsdc(BigInt(p.envelope.hint.amount))}
              </Text>
              <Text style={styles.noteMeta}>
                {p.direction === 'received' ? 'Recibido' : 'Enviado'} ·{' '}
                {p.attempts > 0 ? `${p.attempts} intentos` : 'esperando red'}
              </Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing(3), paddingBottom: spacing(6) },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing(3) },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing(1) },
  statusText: { color: theme.textMuted, fontSize: 13 },
  label: { color: theme.textMuted, fontSize: 14 },
  balance: { color: theme.text, fontSize: 52, fontWeight: '700', letterSpacing: -1.5 },
  sub: { color: theme.textMuted, fontSize: 13, marginTop: spacing(0.5) },
  actions: { flexDirection: 'row', gap: spacing(1.5), marginVertical: spacing(3) },
  button: { flex: 1, paddingVertical: spacing(2), borderRadius: 14, alignItems: 'center' },
  primary: { backgroundColor: theme.accent },
  primaryText: { color: '#04120C', fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border },
  secondaryText: { color: theme.text, fontSize: 16, fontWeight: '600' },
  section: {
    color: theme.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing(2),
    marginBottom: spacing(1),
  },
  note: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing(2),
    marginBottom: spacing(1),
    borderWidth: 1,
    borderColor: theme.border,
  },
  notePending: { borderColor: theme.warning },
  noteAmount: { color: theme.text, fontSize: 20, fontWeight: '600' },
  noteMeta: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
  empty: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing(2.5),
    borderWidth: 1,
    borderColor: theme.border,
  },
  emptyText: { color: theme.textMuted, fontSize: 14, lineHeight: 20 },
});
