import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { buildVoucher } from '@noncepayment/sdk';

import { Ledger, selectNote, updateLedger } from '../store/ledger';
import { DeviceKeyError } from '../store/deviceKey';
import type { DeviceKeyState } from '../store/useDeviceKey';
import { enqueueVoucher } from '../net/settlement';
import { bestTransport } from '../transport';
import { formatUsdc, parseUsdc } from '../ui/format';
import { theme, spacing } from '../ui/theme';

interface Props {
  ledger: Ledger;
  deviceKey: DeviceKeyState;
  onDone: () => void;
}

type Phase = 'amount' | 'recipient' | 'signing' | 'transmitting' | 'done';

export function PayScreen({ ledger, deviceKey, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('amount');
  const [amountText, setAmountText] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [transportLabel, setTransportLabel] = useState('');

  async function pay() {
    setError(null);
    try {
      const amount = parseUsdc(amountText);
      if (amount <= 0n) throw new Error('Importe invalido');

      // TODO(dia 17-21): resolver dominios .skr aqui. Es el bonus SKR de $10.000.
      const recipient = new PublicKey(recipientText.trim());

      const note = selectNote(ledger, amount);
      if (!note) throw new Error('No tienes ningun billete que cubra ese importe');

      // 1. Barrera biometrica. Este es el unico momento en que se toca la clave, y el
      //    titulo del aviso del sistema dice lo que se esta autorizando: si alguien te
      //    coge el movil desbloqueado, esto es lo que le para.
      setPhase('signing');
      const signer = await deviceKey.unlock(`Pagar $${formatUsdc(amount)}`);

      // 2. Firma OFFLINE. Aqui no hay ni una llamada de red.
      const envelope = buildVoucher({ slot: note, deviceKey: signer, recipient, amount });

      // 3. Transmision por el mejor canal disponible.
      setPhase('transmitting');
      const transport = await bestTransport();
      setTransportLabel(transport.label);
      const payload = Uint8Array.from(Buffer.from(JSON.stringify(envelope), 'utf8'));
      await transport.send(payload);

      // 4. Marcar el billete como gastado y guardar copia para reintentar liquidacion.
      await updateLedger((l) => ({
        ...l,
        slots: l.slots.map((s) =>
          // By nonce account, not index: a closed banknote's index gets reused by later
          // loads, and the history entry must not be marked spent along with the new one.
          s.nonceAccount === note.nonceAccount ? { ...s, status: 'spent_pending_settlement' } : s,
        ),
      }));
      await enqueueVoucher({
        envelope,
        direction: 'sent',
        receivedAt: new Date().toISOString(),
        attempts: 0,
      });

      setPhase('done');
    } catch (e) {
      setError(explain(e));
      setPhase('amount');
    }
  }

  if (phase === 'signing' || phase === 'transmitting') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.centerText}>
          {phase === 'signing'
            ? 'Firmando sin conexion...'
            : `Acerca los moviles — ${transportLabel}`}
        </Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={styles.center}>
        <Text style={styles.bigCheck}>✓</Text>
        <Text style={styles.doneAmount}>${amountText} enviados</Text>
        <Text style={styles.centerText}>
          Se liquidara en Solana automaticamente cuando vuelva la cobertura.
        </Text>
        <Pressable style={styles.primary} onPress={onDone}>
          <Text style={styles.primaryText}>Hecho</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pagar</Text>

      <Text style={styles.label}>Importe (USDC)</Text>
      <TextInput
        style={styles.input}
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor={theme.textMuted}
      />

      <Text style={styles.label}>Destinatario</Text>
      <TextInput
        style={styles.input}
        value={recipientText}
        onChangeText={setRecipientText}
        autoCapitalize="none"
        placeholder="direccion o david.skr"
        placeholderTextColor={theme.textMuted}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.primary} onPress={pay}>
        <Text style={styles.primaryText}>Firmar y enviar</Text>
      </Pressable>
      <Pressable style={styles.ghost} onPress={onDone}>
        <Text style={styles.ghostText}>Cancelar</Text>
      </Pressable>
    </View>
  );
}

/**
 * What went wrong, said in terms of what to do about it.
 *
 * The device key has failure modes that are not failures — a cancelled fingerprint is a
 * decision — and one that is genuinely serious: a key Android has destroyed. They read
 * very differently to somebody standing at a counter, so they are worded very
 * differently. Anything else keeps its own text.
 */
function explain(e: unknown): string {
  if (e instanceof DeviceKeyError) {
    switch (e.code) {
      case 'CANCELLED':
        return 'Pago cancelado: no se ha confirmado la identidad.';
      case 'NO_KEY':
        return 'Este movil todavia no tiene clave de pago. Creala en la pantalla principal.';
      case 'INVALIDATED':
      case 'MISMATCH':
        return 'La clave de pago de este movil ya no sirve. Vuelve atras para generar una nueva.';
      case 'BIOMETRICS_GONE':
        return 'Ya no hay biometria configurada en el movil, asi que no se puede firmar.';
      case 'BUSY':
        return 'Ya hay una confirmacion abierta. Terminala y vuelve a intentarlo.';
      default:
        return e.message;
    }
  }
  return String((e as any)?.message ?? e);
}

const styles = StyleSheet.create({
  container: { padding: spacing(3), flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(4) },
  centerText: {
    color: theme.textMuted,
    marginTop: spacing(2),
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 21,
  },
  bigCheck: { color: theme.accent, fontSize: 64 },
  doneAmount: { color: theme.text, fontSize: 26, fontWeight: '700', marginTop: spacing(1) },
  title: { color: theme.text, fontSize: 28, fontWeight: '700', marginBottom: spacing(3) },
  label: { color: theme.textMuted, fontSize: 13, marginBottom: spacing(0.5) },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing(2),
    color: theme.text,
    fontSize: 18,
    marginBottom: spacing(2),
  },
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: spacing(2),
    alignItems: 'center',
    marginTop: spacing(2),
  },
  primaryText: { color: '#04120C', fontSize: 16, fontWeight: '700' },
  ghost: { paddingVertical: spacing(2), alignItems: 'center' },
  ghostText: { color: theme.textMuted, fontSize: 15 },
  error: { color: theme.danger, fontSize: 14, marginBottom: spacing(1) },
});
