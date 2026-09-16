/**
 * Load banknotes: turn wallet USDC into cash the phone can spend offline.
 *
 * Fixed denominations on purpose (NOTE_DENOMINATIONS): they read as cash, and they bound
 * what any single banknote can lose. The screen is honest about the two costs a user
 * would not guess — rent locked per banknote, returned when it closes, and the SOL the
 * device key needs to pay voucher fees — because "why did my SOL go down?" is the first
 * question otherwise.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { NOTE_DENOMINATIONS, USDC_DECIMALS } from '@noncepayment/sdk';

import {
  LoadCost,
  LoadResult,
  LoadStep,
  MAX_NOTES_PER_LOAD,
  estimateLoadCost,
  loadNotes,
} from '../net/loading';
import { connection } from '../net/settlement';
import { formatUsdc } from '../ui/format';
import { theme, spacing } from '../ui/theme';
import { explain, WalletState } from '../wallet/useWallet';

interface Props {
  wallet: WalletState;
  deviceKey: PublicKey;
  onDone: () => void;
}

/** Fee headroom per transaction when checking the owner's SOL. Generous on purpose. */
const FEE_PER_TX_LAMPORTS = 10_000;

const STEP_TEXT: Record<LoadStep, string> = {
  wallet: 'Aprueba la carga en tu wallet...',
  preparing: 'Preparando los billetes...',
  confirming: 'Esperando confirmacion de la red...',
  syncing: 'Leyendo tus billetes de la cadena...',
};

const unit = 10n ** BigInt(USDC_DECIMALS);
const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);

export function LoadScreen({ wallet, deviceKey, onDone }: Props) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [cost, setCost] = useState<LoadCost | null>(null);
  const [ownerLamports, setOwnerLamports] = useState<number | null>(null);
  const [step, setStep] = useState<LoadStep | null>(null);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owner = wallet.session?.publicKey ?? null;

  useEffect(() => {
    estimateLoadCost(deviceKey).then(setCost).catch(() => undefined);
    if (owner) {
      connection().getBalance(owner, 'confirmed').then(setOwnerLamports).catch(() => undefined);
    }
  }, [deviceKey, owner]);

  const amounts = useMemo(
    () =>
      NOTE_DENOMINATIONS.flatMap((d) =>
        Array.from({ length: counts[d] ?? 0 }, () => BigInt(d) * unit),
      ),
    [counts],
  );
  const total = amounts.reduce((a, b) => a + b, 0n);
  const noteCount = amounts.length;

  const solNeeded = cost
    ? noteCount * cost.rentPerNoteLamports +
      cost.deviceKeyTopUpLamports +
      Math.ceil(noteCount / 2) * FEE_PER_TX_LAMPORTS
    : null;

  const usdc = wallet.balances.usdc;
  const problem =
    noteCount === 0
      ? null
      : !wallet.balances.hasUsdcAccount
        ? 'Tu wallet no tiene USDC de devnet.'
        : usdc !== null && total > usdc
          ? `Solo tienes $${formatUsdc(usdc)} en la wallet.`
          : solNeeded !== null && ownerLamports !== null && solNeeded > ownerLamports
            ? `Hacen falta ${sol(solNeeded)} SOL y la wallet tiene ${sol(ownerLamports)}.`
            : null;

  const change = (d: number, by: number) =>
    setCounts((c) => {
      const next = Math.max(0, (c[d] ?? 0) + by);
      if (by > 0 && noteCount >= MAX_NOTES_PER_LOAD) return c;
      return { ...c, [d]: next };
    });

  async function submit() {
    setError(null);
    try {
      const r = await loadNotes({ deviceKey, amounts, onStep: setStep });
      setResult(r);
      wallet.refresh();
    } catch (e: any) {
      setError(explain(e));
    } finally {
      setStep(null);
    }
  }

  if (step) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.stepText}>{STEP_TEXT[step]}</Text>
        <Text style={styles.muted}>
          {noteCount} {noteCount === 1 ? 'billete' : 'billetes'} · ${formatUsdc(total)}
        </Text>
      </View>
    );
  }

  if (result) {
    const { report } = result;
    return (
      <View style={styles.center}>
        <Text style={styles.done}>✓</Text>
        <Text style={styles.title}>Efectivo cargado</Text>
        <Text style={styles.muted}>
          ${formatUsdc(total)} en {noteCount} {noteCount === 1 ? 'billete' : 'billetes'}.
          Ya puedes pagar sin cobertura.
        </Text>
        <Text style={styles.muted}>
          {report.spendable} {report.spendable === 1 ? 'billete disponible' : 'billetes disponibles'} en total
        </Text>
        {(report.foreign > 0 || report.broken > 0) && (
          <Text style={styles.warning}>
            {report.foreign + report.broken} billetes de esta wallet no se pueden gastar desde este
            movil (clave de dispositivo anterior). Hay que recuperarlos con reclaim.
          </Text>
        )}
        <Pressable style={[styles.button, styles.primary]} onPress={onDone}>
          <Text style={styles.primaryText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable onPress={onDone}>
        <Text style={styles.back}>‹ Volver</Text>
      </Pressable>

      <Text style={styles.title}>Cargar billetes</Text>
      <Text style={styles.muted}>
        En la wallet: {usdc === null ? '—' : `$${formatUsdc(usdc)}`} USDC
        {ownerLamports !== null && ` · ${sol(ownerLamports)} SOL`}
      </Text>

      <View style={styles.list}>
        {NOTE_DENOMINATIONS.map((d) => (
          <View key={d} style={styles.row}>
            <Text style={styles.denomination}>${d}</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepButton} onPress={() => change(d, -1)} hitSlop={8}>
                <Text style={styles.stepSign}>−</Text>
              </Pressable>
              <Text style={styles.count}>{counts[d] ?? 0}</Text>
              <Pressable style={styles.stepButton} onPress={() => change(d, +1)} hitSlop={8}>
                <Text style={styles.stepSign}>+</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.summary}>
        <Text style={styles.total}>${formatUsdc(total)}</Text>
        <Text style={styles.muted}>
          {noteCount} {noteCount === 1 ? 'billete' : 'billetes'} (maximo {MAX_NOTES_PER_LOAD} por carga)
        </Text>
        {cost && noteCount > 0 && (
          <>
            <Text style={styles.costLine}>
              Renta: {sol(noteCount * cost.rentPerNoteLamports)} SOL — se devuelve al gastar o
              recuperar cada billete
            </Text>
            {cost.deviceKeyTopUpLamports > 0 && (
              <Text style={styles.costLine}>
                + {sol(cost.deviceKeyTopUpLamports)} SOL a la clave de dispositivo, para las
                comisiones de tus pagos
              </Text>
            )}
          </>
        )}
      </View>

      {problem && <Text style={styles.warning}>{problem}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, noteCount > 0 && !problem ? styles.primary : styles.disabled]}
        disabled={noteCount === 0 || !!problem}
        onPress={submit}
      >
        <Text style={noteCount > 0 && !problem ? styles.primaryText : styles.disabledText}>
          {noteCount === 0 ? 'Elige billetes' : `Cargar $${formatUsdc(total)}`}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing(3), paddingBottom: spacing(6) },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(3),
    gap: spacing(1),
  },
  back: { color: theme.accent, fontSize: 16, marginBottom: spacing(2) },
  title: { color: theme.text, fontSize: 26, fontWeight: '700' },
  muted: { color: theme.textMuted, fontSize: 13, marginTop: spacing(0.5), textAlign: 'center' },
  list: { marginTop: spacing(3), gap: spacing(1) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
  },
  denomination: { color: theme.text, fontSize: 22, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepSign: { color: theme.text, fontSize: 20, fontWeight: '600' },
  count: { color: theme.text, fontSize: 18, fontWeight: '600', minWidth: 20, textAlign: 'center' },
  summary: { marginTop: spacing(3), alignItems: 'center' },
  total: { color: theme.text, fontSize: 44, fontWeight: '700', letterSpacing: -1 },
  costLine: { color: theme.textMuted, fontSize: 12, marginTop: spacing(1), textAlign: 'center', lineHeight: 17 },
  warning: { color: theme.warning, fontSize: 13, marginTop: spacing(2), textAlign: 'center', lineHeight: 18 },
  error: { color: theme.danger, fontSize: 13, marginTop: spacing(2), lineHeight: 18 },
  stepText: { color: theme.text, fontSize: 17, fontWeight: '600', marginTop: spacing(2) },
  done: { color: theme.accent, fontSize: 56, fontWeight: '700' },
  button: {
    marginTop: spacing(3),
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(4),
    borderRadius: 14,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primary: { backgroundColor: theme.accent },
  primaryText: { color: '#04120C', fontSize: 16, fontWeight: '700' },
  disabled: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border },
  disabledText: { color: theme.textMuted, fontSize: 16, fontWeight: '600' },
});
