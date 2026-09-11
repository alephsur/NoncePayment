/**
 * The real wallet: connect, and what it holds.
 *
 * This is the ONLINE half of the product. The USDC shown here is not spendable offline —
 * it has to be turned into banknotes first — and the card says so, because the gap
 * between "I have 50 USDC" and "I can pay without coverage" is the single thing a new
 * user gets wrong.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatUsdc, shortKey } from './format';
import { theme, spacing } from './theme';
import type { WalletState } from '../wallet/useWallet';

interface Props {
  wallet: WalletState;
  online: boolean;
}

export function WalletCard({ wallet, online }: Props) {
  const { status, session, balances, error } = wallet;

  if (status === 'disconnected') {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Wallet</Text>
        <Text style={styles.hint}>
          Conecta tu wallet para cargar efectivo. Solo hace falta con red: pagar y cobrar
          funcionan sin ella.
        </Text>
        <Pressable
          style={[styles.button, !online && styles.buttonDisabled]}
          onPress={wallet.connect}
          disabled={!online}
        >
          <Text style={styles.buttonText}>
            {online ? 'Conectar wallet' : 'Sin red'}
          </Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  if (status === 'connecting') {
    return (
      <View style={[styles.card, styles.centered]}>
        <ActivityIndicator color={theme.accent} />
        <Text style={styles.hint}>Esperando a la wallet...</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>Wallet</Text>
        <Pressable onPress={wallet.disconnect} hitSlop={10}>
          <Text style={styles.disconnect}>Desconectar</Text>
        </Pressable>
      </View>

      <Pressable onPress={wallet.refresh} disabled={!online}>
        <Text style={styles.amount}>
          {balances.usdc === null ? '—' : `$${formatUsdc(balances.usdc)}`}
          <Text style={styles.unit}> USDC</Text>
        </Text>
      </Pressable>

      <Text style={styles.account}>
        {session?.label ? `${session.label} · ` : ''}
        {session && shortKey(session.publicKey.toBase58())}
        {status === 'stale' && ' · sesion caducada'}
      </Text>

      {!balances.hasUsdcAccount && balances.usdc !== null && (
        <Text style={styles.hint}>
          Esta wallet no tiene cuenta de USDC en devnet todavia. Se creara sola cuando
          recibas los primeros dolares.
        </Text>
      )}

      {status === 'stale' && (
        <Pressable style={styles.button} onPress={wallet.connect} disabled={!online}>
          <Text style={styles.buttonText}>Reautorizar</Text>
        </Pressable>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.note}>
        Este saldo NO se puede gastar sin cobertura. Cargalo como billetes primero.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing(2),
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: spacing(1),
  },
  centered: { alignItems: 'center', gap: spacing(1), paddingVertical: spacing(3) },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: theme.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  disconnect: { color: theme.textMuted, fontSize: 12 },
  amount: {
    color: theme.text,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginTop: spacing(1),
  },
  unit: { color: theme.textMuted, fontSize: 15, fontWeight: '600' },
  account: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
    marginTop: spacing(1.5),
  },
  buttonDisabled: { backgroundColor: theme.surfaceAlt },
  buttonText: { color: '#04120C', fontSize: 15, fontWeight: '700' },
  hint: { color: theme.textMuted, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
  note: { color: theme.textMuted, fontSize: 11, marginTop: spacing(1.5), lineHeight: 15 },
  error: { color: theme.danger, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
});
