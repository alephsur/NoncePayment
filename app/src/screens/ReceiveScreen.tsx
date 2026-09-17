import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { verifyVoucher, VerificationLevel, VoucherError } from '@noncepayment/sdk';

import { enqueueVoucher, drainSettlementQueue, isOnline } from '../net/settlement';
import { bestTransport, encodeAddressTag, stopCardEmulation } from '../transport';
import { formatUsdc, shortKey } from '../ui/format';
import { theme, spacing } from '../ui/theme';

interface Props {
  deviceKey: PublicKey;
  onDone: () => void;
}

export function ReceiveScreen({ deviceKey, onDone }: Props) {
  const [state, setState] = useState<'idle' | 'offering' | 'waiting' | 'verified' | 'error'>(
    'idle',
  );
  const [amount, setAmount] = useState<bigint>(0n);
  const [payer, setPayer] = useState('');
  const [level, setLevel] = useState<VerificationLevel>(VerificationLevel.CRYPTO_ONLY);
  const [error, setError] = useState('');

  // The reader stays on until it is told otherwise, so leaving the screen has to tell it.
  // Without this the phone went on reading NFC from the home screen, invisibly.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => {
    abort.current?.abort();
    stopCardEmulation().catch(() => undefined);
  }, []);

  function cancel() {
    abort.current?.abort();
    stopCardEmulation().catch(() => undefined);
    onDone();
  }

  /**
   * Los dos taps, en orden, con el cambio de rol en medio.
   *
   * PRIMERO este movil es la tarjeta y ofrece su direccion; DESPUES es el lector y espera
   * el voucher. No pueden solaparse: el modo lector apaga la emulacion de este mismo
   * telefono, asi que un rol excluye al otro y hay que pasar de uno a otro.
   *
   * El cambio no necesita que el usuario haga nada: `send` resuelve cuando el otro movil
   * ha leido y se ha apartado, que es exactamente el instante en que el pagador se lleva
   * el suyo para confirmar el importe y poner la huella. Para cuando vuelve a acercarlo,
   * este ya esta escuchando.
   */
  async function listen() {
    setError('');
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      const transport = await bestTransport();

      // Tap 1: la direccion. Sin firma y sin secretos — ver transport/address.ts.
      setState('offering');
      await transport.send(encodeAddressTag({ v: 1, recipient: deviceKey.toBase58() }), signal);
      await transport.stop();

      // Tap 2: el dinero.
      setState('waiting');
      const payload = await transport.receive(signal);
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

  if (state === 'offering') {
    return (
      <View style={styles.center}>
        <Text style={styles.tapNumber}>1 / 2</Text>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.centerText}>Acerca el otro movil para darle tu direccion</Text>
        <Text style={styles.waitHint}>
          No hay que escribir nada: el pago sabra a quien va con solo juntarlos.
        </Text>
        <Pressable style={styles.ghost} onPress={cancel}>
          <Text style={styles.ghostText}>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  if (state === 'waiting') {
    return (
      <View style={styles.center}>
        <Text style={styles.tapNumber}>2 / 2</Text>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.centerText}>Esperando el pago — vuelve a acercarlo</Text>
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
      <Text style={styles.centerText}>
        Son dos toques: el primero le da tu direccion, el segundo trae el dinero.
      </Text>
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
  tapNumber: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: spacing(2),
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
