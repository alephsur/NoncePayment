/**
 * The two states the app had no answer for: no device key, and a device key Android
 * destroyed.
 *
 * Both are dead ends until the user does something, so both get a screen-sized
 * explanation rather than a warning line. The second one costs money if it is
 * misunderstood — the banknotes are still on chain, still collateralised, and only
 * reachable with `reclaim` from the real wallet — so it says that in as many words
 * instead of offering a cheerful "retry".
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DeviceKeyState } from '../store/useDeviceKey';
import { theme, spacing } from './theme';

interface Props {
  state: DeviceKeyState;
}

export function DeviceKeySetup({ state }: Props) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const noun = state.capability?.noun ?? 'biometria';
  const weak = state.capability !== null && !state.capability.keystoreBound;

  if (state.phase === 'invalidated') {
    return (
      <View style={[styles.card, styles.danger]}>
        <Text style={styles.dangerLabel}>Clave de pago destruida</Text>
        <Text style={styles.body}>
          Android borra la clave cuando cambias la {noun} del movil o reinstalas la app.
          Es una proteccion del sistema y no se puede deshacer.
        </Text>
        <Text style={styles.body}>
          Los billetes que tuvieras cargados siguen en Solana y siguen siendo tuyos, pero
          ya no se pueden pagar sin conexion: hay que recuperarlos con red, desde tu
          wallet.
        </Text>

        {confirmingReset ? (
          <>
            <Text style={styles.confirm}>
              Se generara una clave nueva. Los billetes viejos quedaran pendientes de
              recuperar.
            </Text>
            <Pressable
              style={[styles.button, styles.buttonDanger]}
              onPress={state.regenerate}
              disabled={state.busy}
            >
              <Text style={styles.buttonDangerText}>Si, generar una clave nueva</Text>
            </Pressable>
            <Pressable style={styles.ghost} onPress={() => setConfirmingReset(false)}>
              <Text style={styles.ghostText}>Cancelar</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={styles.button}
            onPress={() => setConfirmingReset(true)}
            disabled={state.busy}
          >
            <Text style={styles.buttonText}>Generar una clave nueva</Text>
          </Pressable>
        )}

        {state.error && <Text style={styles.error}>{state.error}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Activar pagos sin conexion</Text>
      <Text style={styles.body}>
        Este movil necesita su propia clave para poder firmar pagos en modo avion. Se
        genera aqui, no sale nunca del telefono, y solo puede gastar los billetes que tu
        hayas cargado — nunca el saldo de tu wallet.
      </Text>

      {weak ? (
        <Text style={styles.warning}>
          Este movil no tiene un sensor biometrico que el sistema acepte para proteger
          claves. La clave se guardara cifrada igualmente, pero la confirmacion de cada
          pago sera mas debil. Configura huella o PIN en los ajustes de Android.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Te pedira la {noun} al crearla, y otra vez en cada pago.
        </Text>
      )}

      <Pressable style={styles.button} onPress={state.create} disabled={state.busy}>
        {state.busy ? (
          <ActivityIndicator color="#04120C" />
        ) : (
          <Text style={styles.buttonText}>Crear la clave de este movil</Text>
        )}
      </Pressable>

      {state.error && <Text style={styles.error}>{state.error}</Text>}
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
  danger: { borderColor: theme.danger },
  label: {
    color: theme.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dangerLabel: {
    color: theme.danger,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  body: { color: theme.text, fontSize: 13, lineHeight: 19, marginTop: spacing(1) },
  hint: { color: theme.textMuted, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
  warning: { color: theme.warning, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
  confirm: { color: theme.warning, fontSize: 12, marginTop: spacing(1.5), lineHeight: 17 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
    marginTop: spacing(2),
  },
  buttonText: { color: '#04120C', fontSize: 15, fontWeight: '700' },
  buttonDanger: { backgroundColor: theme.danger },
  buttonDangerText: { color: '#1A0505', fontSize: 15, fontWeight: '700' },
  ghost: { paddingVertical: spacing(1.5), alignItems: 'center' },
  ghostText: { color: theme.textMuted, fontSize: 14 },
  error: { color: theme.danger, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
});
