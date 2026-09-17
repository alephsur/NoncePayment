/**
 * Pagar: dos toques y ni una tecla.
 *
 * El primero lee la direccion del que cobra, el segundo le entrega el pago firmado. En
 * medio, dos cosas que no son negociables: el pagador VE a quien esta pagando, y pone su
 * huella. Firmar a ciegas lo que diga un tap seria el fallo de seguridad del gesto.
 *
 * Escribir la direccion a mano sigue ahi, y no como reliquia: es la salida para un movil
 * sin NFC y la unica manera de pagar a alguien que no esta delante.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { buildVoucher } from '@noncepayment/sdk';

import { Ledger, selectNote, updateLedger } from '../store/ledger';
import type { DeviceKeyState } from '../store/useDeviceKey';
import { enqueueVoucher } from '../net/settlement';
import { bestTransport, decodeAddressTag, stopCardEmulation } from '../transport';
import { explainDeviceKeyError } from '../ui/errors';
import { formatUsdc, parseUsdc, shortKey } from '../ui/format';
import { theme, spacing } from '../ui/theme';

interface Props {
  ledger: Ledger;
  deviceKey: DeviceKeyState;
  onDone: () => void;
}

type Phase = 'amount' | 'reading' | 'confirm' | 'signing' | 'transmitting' | 'done';

export function PayScreen({ ledger, deviceKey, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('amount');
  const [amountText, setAmountText] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [manual, setManual] = useState(false);
  const [target, setTarget] = useState<{ key: PublicKey; label?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transportLabel, setTransportLabel] = useState('');

  const abort = useRef<AbortController | null>(null);

  // Paid, cancelled, or backed out of mid-tap: nothing keeps emulating or reading once
  // this screen is gone.
  useEffect(() => () => {
    abort.current?.abort();
    stopCardEmulation().catch(() => undefined);
  }, []);

  /** Importe y billete, validados antes de tocar nada mas. */
  function prepare(): bigint {
    const amount = parseUsdc(amountText);
    if (amount <= 0n) throw new Error('Importe invalido');
    if (!selectNote(ledger, amount)) {
      throw new Error('No tienes ningun billete que cubra ese importe');
    }
    return amount;
  }

  /** Tap 1: leer a quien se paga. */
  async function readRecipient() {
    setError(null);
    try {
      prepare();
      abort.current = new AbortController();
      setPhase('reading');
      const transport = await bestTransport();
      setTransportLabel(transport.label);
      const tag = decodeAddressTag(await transport.receive(abort.current.signal));
      setTarget({ key: new PublicKey(tag.recipient), label: tag.label });
      setPhase('confirm');
    } catch (e) {
      setError(explainDeviceKeyError(e, 'Pago cancelado.'));
      setPhase('amount');
    }
  }

  /** Tap 2: firmar y entregar. */
  async function pay(recipient: PublicKey) {
    setError(null);
    try {
      const amount = prepare();
      const note = selectNote(ledger, amount)!;

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
      // The tag deliberately stays live until this screen is left.
      //
      // `send` resolves when the library reports a read, and that report is a hint, not
      // proof: a reader that touched the tag and pulled away before the content came
      // across counts as a read. When that happens the recipient has nothing, and the one
      // useful thing the payer can do is hold the phones together again — which needs the
      // tag still there. Leaving the screen stops it, and so does opening the app.

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
      await stopCardEmulation().catch(() => undefined);
      setError(explainDeviceKeyError(e, 'Pago cancelado: no se ha confirmado la identidad.'));
      setPhase(target ? 'confirm' : 'amount');
    }
  }

  function payTyped() {
    setError(null);
    try {
      // TODO(dia 18): resolver dominios .skr aqui. Es el bonus SKR de $10.000.
      pay(new PublicKey(recipientText.trim()));
    } catch {
      setError('Esa direccion no es valida');
    }
  }

  if (phase === 'reading') {
    return (
      <View style={styles.center}>
        <Text style={styles.tapNumber}>1 / 2</Text>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.centerText}>Acerca los moviles — {transportLabel}</Text>
        <Text style={styles.hint}>
          Manten los moviles juntos un segundo: este primer toque solo trae la direccion
          de quien cobra. Todavia no se paga nada.
        </Text>
        <Pressable
          style={styles.ghost}
          onPress={() => {
            abort.current?.abort();
            setPhase('amount');
          }}
        >
          <Text style={styles.ghostText}>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'confirm' && target) {
    return (
      <View style={styles.center}>
        <Text style={styles.label}>Vas a pagar</Text>
        <Text style={styles.confirmAmount}>${formatUsdc(parseUsdc(amountText || '0'))}</Text>
        <Text style={styles.centerText}>a</Text>
        <Text style={styles.confirmWho}>{target.label ?? shortKey(target.key.toBase58())}</Text>
        <Text style={styles.confirmAddress}>{target.key.toBase58()}</Text>
        <Text style={styles.hint}>
          Comprueba que es quien crees antes de seguir: esta direccion la ha dado el otro
          movil y es la que se quedara con el dinero.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.primary} onPress={() => pay(target.key)}>
          <Text style={styles.primaryText}>Pagar con huella</Text>
        </Pressable>
        <Pressable
          style={styles.ghost}
          onPress={() => {
            setTarget(null);
            setPhase('amount');
          }}
        >
          <Text style={styles.ghostText}>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'signing' || phase === 'transmitting') {
    return (
      <View style={styles.center}>
        {phase === 'transmitting' && <Text style={styles.tapNumber}>2 / 2</Text>}
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.centerText}>
          {phase === 'signing'
            ? 'Firmando sin conexion...'
            : `Vuelve a acercar los moviles — ${transportLabel}`}
        </Text>
        {phase === 'transmitting' && (
          <Text style={styles.hint}>
            Ahora viaja el pago. Manten los moviles pegados hasta que el otro lo confirme.
          </Text>
        )}
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
        <Text style={styles.retryHint}>
          Si en el otro movil no ha aparecido el cobro, vuelve a juntarlos sin salir de
          esta pantalla y mantenlos pegados un segundo mas: el pago sigue disponible y es
          el mismo, no se puede cobrar dos veces.
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
        autoFocus
      />

      {manual && (
        <>
          <Text style={styles.label}>Destinatario</Text>
          <TextInput
            style={styles.input}
            value={recipientText}
            onChangeText={setRecipientText}
            autoCapitalize="none"
            placeholder="direccion o david.skr"
            placeholderTextColor={theme.textMuted}
          />
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {manual ? (
        <Pressable style={styles.primary} onPress={payTyped}>
          <Text style={styles.primaryText}>Firmar y enviar</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.primary} onPress={readRecipient}>
          <Text style={styles.primaryText}>Acercar para pagar</Text>
        </Pressable>
      )}

      <Pressable style={styles.ghost} onPress={() => setManual((m) => !m)}>
        <Text style={styles.ghostText}>
          {manual ? 'Pagar acercando los moviles' : 'Escribir la direccion a mano'}
        </Text>
      </Pressable>
      <Pressable style={styles.ghost} onPress={onDone}>
        <Text style={styles.ghostText}>Cancelar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing(3), flex: 1 },
  tapNumber: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: spacing(2),
  },
  hint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing(2),
    paddingHorizontal: spacing(2),
  },
  confirmAmount: { color: theme.text, fontSize: 48, fontWeight: '700', letterSpacing: -1 },
  confirmWho: { color: theme.text, fontSize: 20, fontWeight: '700', marginTop: spacing(0.5) },
  confirmAddress: {
    color: theme.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: spacing(1),
    paddingHorizontal: spacing(2),
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(4) },
  retryHint: {
    color: theme.warning,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing(2),
    paddingHorizontal: spacing(2),
  },
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
