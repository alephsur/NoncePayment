/**
 * Lo cobrado, y la unica salida que tiene.
 *
 * Un pago recibido no es un billete: `redeem` deja USDC normal en la cuenta de tokens de
 * la clave de dispositivo. No suma al saldo grande de la home a proposito — con eso no
 * se puede pagar en modo avion — pero tiene que verse, porque durante un tiempo no se
 * veia y el telefono decia $0.00 con el dinero ya en cadena.
 *
 * El boton existe porque sin el ese dinero no sale del telefono jamas: la clave privada
 * vive en el Keystore y ninguna otra herramienta puede firmar por ella.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { WithdrawStep, withdrawReceived } from '../net/withdraw';
import type { DeviceKeyState } from '../store/useDeviceKey';
import { explain as explainWalletError, WalletState } from '../wallet/useWallet';
import { explainDeviceKeyError } from './errors';
import { formatUsdc, shortKey } from './format';
import { theme, spacing } from './theme';

interface Props {
  amount: bigint;
  wallet: WalletState;
  deviceKey: DeviceKeyState;
  online: boolean;
  onDone: () => void;
}

const STEP_TEXT: Record<WithdrawStep, string> = {
  checking: 'Comprobando tu wallet...',
  wallet: 'Aprueba el traspaso en tu wallet...',
  confirming: 'Esperando confirmacion de la red...',
  syncing: 'Actualizando tu saldo...',
};

export function ReceivedCard({ amount, wallet, deviceKey, online, onDone }: Props) {
  const [step, setStep] = useState<WithdrawStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canWithdraw = online && wallet.session !== null && deviceKey.phase === 'ready';

  async function withdraw() {
    setError(null);
    try {
      // La huella primero, antes de que la wallet se ponga delante. Ver net/withdraw.ts.
      const signer = await deviceKey.unlock(`Pasar $${formatUsdc(amount)} a tu wallet`);
      await withdrawReceived({ signer, amount, onStep: setStep });
      setDone(true);
      onDone();
    } catch (e) {
      // Dos capas pueden fallar aqui y hablan idiomas distintos: la clave de dispositivo
      // y la wallet. Lo que no reconoce la primera se lo pasa a la segunda, y asi un
      // error nativo opaco no acaba en pantalla tal cual — que es lo que pasaba.
      const fromKey = explainDeviceKeyError(
        e,
        'Traspaso cancelado: no se ha confirmado la identidad.',
      );
      const raw = String((e as any)?.message ?? e);
      setError(fromKey === raw ? explainWalletError(e) : fromKey);
    } finally {
      setStep(null);
    }
  }

  if (done) {
    return (
      <View style={[styles.card, styles.okBorder]}>
        <Text style={styles.okTitle}>✓ Traspasado a tu wallet</Text>
        <Text style={styles.body}>
          Ya esta en {wallet.session ? shortKey(wallet.session.publicKey.toBase58()) : 'tu wallet'}.
          Desde ahi puedes volver a cargarlo como billetes para pagar sin cobertura.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.amount}>
        ${formatUsdc(amount)}
        <Text style={styles.unit}> USDC</Text>
      </Text>
      <Text style={styles.body}>
        Lo que has cobrado en pagos. Esta en la cuenta de este movil, no en un billete, asi
        que con ello no se puede pagar sin conexion. Pasalo a tu wallet y desde alli
        cargalo como billetes.
      </Text>

      {step ? (
        <View style={styles.working}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.workingText}>{STEP_TEXT[step]}</Text>
        </View>
      ) : (
        <Pressable
          style={[styles.button, !canWithdraw && styles.buttonDisabled]}
          onPress={withdraw}
          disabled={!canWithdraw || deviceKey.busy}
        >
          <Text style={canWithdraw ? styles.buttonText : styles.buttonTextDisabled}>
            {!online
              ? 'Pasar a mi wallet · sin red'
              : !wallet.session
                ? 'Pasar a mi wallet · conecta la wallet'
                : 'Pasar a mi wallet'}
          </Text>
        </Pressable>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing(2),
    borderWidth: 1,
    borderColor: theme.accent,
  },
  okBorder: { borderColor: theme.accent },
  okTitle: { color: theme.accent, fontSize: 16, fontWeight: '700' },
  amount: { color: theme.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  unit: { color: theme.textMuted, fontSize: 14, fontWeight: '600' },
  body: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing(1) },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
    marginTop: spacing(2),
  },
  buttonDisabled: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border },
  buttonText: { color: '#04120C', fontSize: 15, fontWeight: '700' },
  buttonTextDisabled: { color: theme.textMuted, fontSize: 15, fontWeight: '600' },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginTop: spacing(2) },
  workingText: { color: theme.text, fontSize: 13 },
  error: { color: theme.danger, fontSize: 12, marginTop: spacing(1), lineHeight: 17 },
});
