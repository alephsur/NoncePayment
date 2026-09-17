/**
 * The device key, in full, copyable, with its SOL balance — and what is guarding it.
 *
 * The address exists here for a practical reason: the device key pays the fees of every
 * voucher and the rent of the recipient's token account, so it needs SOL of its own —
 * and it is generated on the phone, which means there is no other way to learn its
 * address. A truncated `9yEY...Se5F` is useless for funding it. You need the whole
 * thing, on the clipboard.
 *
 * The protection line exists for a different one. "Protected by your fingerprint" and
 * "protected by the lock screen" are different promises, and which one is true was
 * decided by the phone's hardware at the moment the key was created, not by anything
 * the user can see. So it is stated, and if it is the weak one, it is stated in orange.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { DEVICE_KEY_FUNDING_LAMPORTS } from '@noncepayment/sdk';

import { connection } from '../net/settlement';
import type { DeviceKeyState } from '../store/useDeviceKey';
import { DeviceKeySetup } from './DeviceKeySetup';
import { theme, spacing } from './theme';

interface Props {
  state: DeviceKeyState;
  online: boolean;
}

/** How long the "copied" confirmation stays up. */
const COPIED_MS = 2000;
/** How long the result of a gate test stays up. */
const TESTED_MS = 3000;

export function DeviceKeyCard({ state, online }: Props) {
  const [copied, setCopied] = useState(false);
  const [tested, setTested] = useState<'ok' | 'failed' | null>(null);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [lamports, setLamports] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const identity = state.phase === 'ready' ? state.identity : null;
  const address = identity?.publicKey.toBase58() ?? '';

  const refreshBalance = useCallback(async () => {
    if (!online || !identity) return;
    setLoading(true);
    try {
      setLamports(await connection().getBalance(identity.publicKey, 'confirmed'));
    } catch {
      // Offline or a flaky RPC. Leave the last known value rather than showing a
      // scary zero, which would read as "your money is gone".
    } finally {
      setLoading(false);
    }
  }, [identity, online]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!tested) return;
    const t = setTimeout(() => setTested(null), TESTED_MS);
    return () => clearTimeout(t);
  }, [tested]);

  if (state.phase === 'loading') {
    return (
      <View style={[styles.card, styles.centered]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!identity) {
    return <DeviceKeySetup state={state} />;
  }

  async function copy() {
    await Clipboard.setStringAsync(address);
    setCopied(true);
  }

  async function testGate() {
    setTested((await state.test()) ? 'ok' : 'failed');
  }

  const needsFunding = lamports !== null && lamports < DEVICE_KEY_FUNDING_LAMPORTS;
  const hardwareBacked = identity.protection === 'keystore_biometric';
  const noun = state.capability?.noun ?? 'biometria';

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

      {/* Which of the two promises is actually being kept on this phone. */}
      <View style={styles.protectionRow}>
        <Text style={[styles.protection, !hardwareBacked && styles.protectionWeak]}>
          {hardwareBacked
            ? `🔒 El sistema exige tu ${noun} para poder firmar`
            : `⚠ Sin proteccion por hardware — confirmacion debil`}
        </Text>
        <Pressable onPress={testGate} hitSlop={8} disabled={state.busy}>
          <Text style={styles.test}>{state.busy ? '...' : 'Probar'}</Text>
        </Pressable>
      </View>

      {tested === 'ok' && <Text style={styles.ok}>✓ El bloqueo funciona</Text>}
      {tested === 'failed' && (
        <Text style={styles.warning}>
          No se ha podido desbloquear. {state.error ?? 'Se ha cancelado.'}
        </Text>
      )}

      {/*
        Decia «para poder cobrar y pagar», y cobrar no cuesta nada: liquidar un cobro
        solo reenvia la transaccion que ya firmo el pagador, y quien paga la comision es
        su clave, no la nuestra. Un movil que solo cobra no necesita SOL jamas, y
        decirle lo contrario le pide que resuelva un problema que no tiene.
      */}
      {needsFunding ? (
        <Text style={styles.warning}>
          Sin SOL suficiente para pagar comisiones. Envia al menos{' '}
          {(DEVICE_KEY_FUNDING_LAMPORTS / LAMPORTS_PER_SOL).toFixed(2)} SOL a esta
          direccion para poder PAGAR. Cobrar no cuesta nada: la comision de cada cobro la
          paga quien paga.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Paga las comisiones de tus pagos. Cobrar no cuesta nada.
        </Text>
      )}

      {confirmingWipe ? (
        <View style={styles.wipeBox}>
          <Text style={styles.wipeText}>
            Borrar la clave deja sin poder pagar los billetes cargados: solo se podran
            recuperar con red, desde tu wallet. Esto no se puede deshacer.
          </Text>
          <Pressable style={styles.wipeConfirm} onPress={state.forget} disabled={state.busy}>
            <Text style={styles.wipeConfirmText}>Si, borrar la clave</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={() => setConfirmingWipe(false)}>
            <Text style={styles.ghostText}>Cancelar</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setConfirmingWipe(true)} hitSlop={8}>
          <Text style={styles.wipeLink}>Borrar la clave de este movil</Text>
        </Pressable>
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
  centered: { alignItems: 'center', paddingVertical: spacing(3) },
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
  protectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(1),
    marginTop: spacing(1.5),
  },
  protection: { color: theme.textMuted, fontSize: 12, lineHeight: 17, flex: 1 },
  protectionWeak: { color: theme.warning },
  test: { color: theme.accent, fontSize: 12, fontWeight: '600' },
  ok: { color: theme.accent, fontSize: 12, marginTop: spacing(1) },
  hint: { color: theme.textMuted, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
  warning: { color: theme.warning, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
  wipeLink: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: spacing(2),
    textDecorationLine: 'underline',
  },
  wipeBox: {
    marginTop: spacing(2),
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: spacing(1.5),
  },
  wipeText: { color: theme.warning, fontSize: 12, lineHeight: 17 },
  wipeConfirm: {
    backgroundColor: theme.danger,
    borderRadius: 10,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
    marginTop: spacing(1.5),
  },
  wipeConfirmText: { color: '#1A0505', fontSize: 15, fontWeight: '700' },
  ghost: { paddingVertical: spacing(1.5), alignItems: 'center' },
  ghostText: { color: theme.textMuted, fontSize: 14 },
});
