/**
 * The device key, in full, copyable, with its SOL balance.
 *
 * This exists for a practical reason: the device key pays the fees of every voucher and
 * the rent of the recipient's token account, so it needs SOL of its own — and it is
 * generated on the phone, which means there is no other way to learn its address. A
 * truncated `9yEY...Se5F` is useless for funding it. You need the whole thing, on the
 * clipboard.
 *
 * It also shows the balance, because "what is my address" and "do I need to top it up"
 * are the same question asked twice.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { DEVICE_KEY_FUNDING_LAMPORTS } from '@noncepayment/sdk';

import { connection } from '../net/settlement';
import { theme, spacing } from './theme';

interface Props {
  deviceKey: PublicKey;
  online: boolean;
}

/** How long the "copied" confirmation stays up. */
const COPIED_MS = 2000;

export function DeviceKeyCard({ deviceKey, online }: Props) {
  const [copied, setCopied] = useState(false);
  const [lamports, setLamports] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const address = deviceKey.toBase58();

  const refreshBalance = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    try {
      setLamports(await connection().getBalance(deviceKey, 'confirmed'));
    } catch {
      // Offline or a flaky RPC. Leave the last known value rather than showing a
      // scary zero, which would read as "your money is gone".
    } finally {
      setLoading(false);
    }
  }, [deviceKey, online]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    await Clipboard.setStringAsync(address);
    setCopied(true);
  }

  const needsFunding = lamports !== null && lamports < DEVICE_KEY_FUNDING_LAMPORTS;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>Clave de dispositivo</Text>
        {online && (
          <Pressable onPress={refreshBalance} hitSlop={10}>
            {loading ? (
              <ActivityIndicator size="small" color={theme.textMuted} />
            ) : (
              <Text style={styles.balance}>
                {lamports === null
                  ? '—'
                  : `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`}
              </Text>
            )}
          </Pressable>
        )}
      </View>

      {/* The whole address, tappable. Anything less can't be used to send funds. */}
      <Pressable onPress={copy} style={styles.addressBox}>
        <Text style={styles.address} selectable>
          {address}
        </Text>
        <Text style={[styles.action, copied && styles.actionDone]}>
          {copied ? '✓ Copiado' : 'Tocar para copiar'}
        </Text>
      </Pressable>

      {needsFunding ? (
        <Text style={styles.warning}>
          Sin SOL suficiente para pagar comisiones. Envia al menos{' '}
          {(DEVICE_KEY_FUNDING_LAMPORTS / LAMPORTS_PER_SOL).toFixed(2)} SOL a esta
          direccion para poder cobrar y pagar billetes.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Paga las comisiones de cada pago. Necesita SOL propio, en devnet.
        </Text>
      )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing(1),
  },
  label: {
    color: theme.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  balance: { color: theme.accent, fontSize: 13, fontWeight: '600' },
  addressBox: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 8,
    padding: spacing(1.5),
  },
  address: {
    color: theme.text,
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 19,
  },
  action: { color: theme.accent, fontSize: 12, marginTop: spacing(1), fontWeight: '600' },
  actionDone: { color: theme.accent },
  hint: { color: theme.textMuted, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
  warning: { color: theme.warning, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
});
