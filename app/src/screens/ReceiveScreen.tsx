import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { verifyVoucher, VerificationLevel, VoucherError } from '@noncepayment/sdk';

import { enqueueVoucher, drainSettlementQueue, isOnline } from '../net/settlement';
import { bestTransport } from '../transport';
import { formatUsdc, shortKey } from '../ui/format';
import { theme, spacing } from '../ui/theme';

interface Props {
  deviceKey: PublicKey;
  onDone: () => void;
}

export function ReceiveScreen({ deviceKey, onDone }: Props) {
  const [state, setState] = useState<'idle' | 'waiting' | 'verified' | 'error'>('idle');
  const [amount, setAmount] = useState<bigint>(0n);
  const [payer, setPayer] = useState('');
  const [level, setLevel] = useState<VerificationLevel>(VerificationLevel.CRYPTO_ONLY);
  const [error, setError] = useState('');

  // The reader stays on until it is told otherwise, so leaving the screen has to tell it.
  // Without this the phone went on reading NFC from the home screen, invisibly.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  function cancel() {
    abort.current?.abort();
    onDone();
  }

  async function listen() {
    setState('waiting');
    setError('');
    abort.current = new AbortController();
    try {
      const transport = await bestTransport();
      const payload = await transport.receive(abort.current.signal);
      const envelope = JSON.parse(Buffer.from(payload).toString('utf8'));

      // Verificacion criptografica completa, SIN RED.
      const verified = verifyVoucher(envelope, deviceKey);

      setAmount(verified.amount);
      setPayer(verified.payer.toBase58());
      setLevel(verified.level);
      setState('verified');

      await enqueueVoucher({
        envelope,
        direction: 'received',
        receivedAt: new Date().toISOString(),
        attempts: 0,
      });

      // Si hay red, liquidar ya: cierra la ventana de riesgo cuanto antes.
      if (await isOnline()) {
        await drainSettlementQueue(deviceKey);
        setLevel(VerificationLevel.ONCHAIN_CONFIRMED);
      }
    } catch (e: any) {
      const code = e instanceof VoucherError ? ` [${e.code}]` : '';
      setError(`${e?.message ?? e}${code}`);
      setState('error');
    }
  }

  if (state === 'waiting') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.centerText}>Esperando pago — acerca el otro movil</Text>
        <Text style={styles.waitHint}>
          Manten los moviles juntos un segundo: un roce descubre el otro telefono pero no
          da tiempo a que cruce el pago.
        </Text>
        <Pressable style={styles.ghost} onPress={cancel}>
          <Text style={styles.ghostText}>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  if (state === 'verified') {
    const confirmed = level === VerificationLevel.ONCHAIN_CONFIRMED;
    return (
      <View style={styles.center}>
        <Text style={styles.bigCheck}>✓</Text>
        <Text style={styles.doneAmount}>${formatUsdc(amount)}</Text>
        <Text style={styles.centerText}>de {shortKey(payer)}</Text>

        <View style={[styles.badge, confirmed ? styles.badgeOk : styles.badgeWarn]}>
          <Text style={styles.badgeText}>
            {confirmed
              ? 'Confirmado en Solana'
              : 'Firma verificada · colateral sin confirmar hasta tener red'}
          </Text>
        </View>

        <Pressable style={styles.primary} onPress={onDone}>
          <Text style={styles.primaryText}>Hecho</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Cobrar</Text>
      {error !== '' && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.primary} onPress={listen}>
        <Text style={styles.primaryText}>Esperar pago</Text>
      </Pressable>
      <Pressable style={styles.ghost} onPress={onDone}>
        <Text style={styles.ghostText}>Volver</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(4) },
  title: { color: theme.text, fontSize: 28, fontWeight: '700', marginBottom: spacing(3) },
  centerText: { color: theme.textMuted, marginTop: spacing(1), textAlign: 'center', fontSize: 15 },
  waitHint: {
    color: theme.textMuted,
    marginTop: spacing(2),
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
  },
  bigCheck: { color: theme.accent, fontSize: 64 },
  doneAmount: { color: theme.text, fontSize: 40, fontWeight: '700', marginTop: spacing(1) },
  badge: { borderRadius: 10, paddingVertical: spacing(1), paddingHorizontal: spacing(2), marginTop: spacing(3) },
  badgeOk: { backgroundColor: 'rgba(20,241,149,0.12)' },
  badgeWarn: { backgroundColor: 'rgba(255,176,32,0.12)' },
  badgeText: { color: theme.text, fontSize: 13, textAlign: 'center' },
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(6),
    alignItems: 'center',
    marginTop: spacing(3),
  },
  primaryText: { color: '#04120C', fontSize: 16, fontWeight: '700' },
  ghost: { paddingVertical: spacing(2), marginTop: spacing(1) },
  ghostText: { color: theme.textMuted, fontSize: 15 },
  error: { color: theme.danger, fontSize: 14, textAlign: 'center', marginBottom: spacing(2) },
});
