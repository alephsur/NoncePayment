/**
 * Cobrar: dos toques, y decir la verdad sobre lo que se ha podido comprobar.
 *
 * ## Donde aterriza el dinero
 *
 * En la wallet del usuario si la tiene conectada; si no, en la clave de dispositivo.
 * La clave funciona siempre y no necesita a nadie, pero lo que cae ahi hay que
 * traspasarlo despues a mano — un paso que el usuario no pidio y que cuesta una
 * comision. Con la wallet conectada, el pago aterriza directamente donde se puede
 * gastar y el traspaso deja de existir.
 *
 * ## El nivel de verificacion, y por que se enseña
 *
 * Sin cobertura se puede comprobar que la firma es autentica y que el voucher esta bien
 * formado. Lo que NO se puede comprobar es que el billete siga teniendo dinero detras:
 * eso vive en la cadena. Fingir certeza ahi seria mentir sobre el unico riesgo real del
 * producto, asi que se dice exactamente hasta donde se ha llegado. Ver THREAT-MODEL.md:
 * «el receptor sabe exactamente que se ha comprobado» es una mitigacion, no un adorno.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import {
  VerificationLevel,
  VoucherError,
  checkSlotFunded,
  verifyVoucherForAny,
} from '@noncepayment/sdk';

import { connection, drainSettlementQueue, enqueueVoucher, isOnline } from '../net/settlement';
import { Ledger, readSlotCheck, writeSlotCheck } from '../store/ledger';
import { bestTransport, encodeAddressTag, stopCardEmulation } from '../transport';
import { formatUsdc, shortKey } from '../ui/format';
import { theme, spacing } from '../ui/theme';
import type { WalletState } from '../wallet/useWallet';

interface Props {
  deviceKey: PublicKey;
  wallet: WalletState;
  online: boolean;
  ledger: Ledger;
  onDone: () => void;
}

/** Cuanto vale una comprobacion de colateral antes de considerarla vieja. */
const CHECK_FRESH_MS = 60 * 60 * 1000;

export function ReceiveScreen({ deviceKey, wallet, online, ledger, onDone }: Props) {
  const [state, setState] = useState<'idle' | 'offering' | 'waiting' | 'verified' | 'error'>(
    'idle',
  );
  const [amount, setAmount] = useState<bigint>(0n);
  const [payer, setPayer] = useState('');
  const [paidTo, setPaidTo] = useState<PublicKey | null>(null);
  const [level, setLevel] = useState<VerificationLevel>(VerificationLevel.CRYPTO_ONLY);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Donde queremos cobrar. La wallet manda cuando la hay: es donde el dinero sirve.
  const payout = wallet.session?.publicKey ?? deviceKey;
  const toWallet = wallet.session !== null;
  // Un voucher legitimo puede ir a cualquiera de las dos, no solo a la que ofrecemos hoy:
  // uno cobrado ayer sin wallet conectada nombra la clave, y sigue siendo nuestro.
  const identities = toWallet ? [wallet.session!.publicKey, deviceKey] : [deviceKey];

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
      await transport.send(
        encodeAddressTag({
          v: 1,
          recipient: payout.toBase58(),
          kind: toWallet ? 'wallet' : 'device',
          label: wallet.session?.label,
        }),
        signal,
      );
      await transport.stop();

      // Tap 2: el dinero.
      setState('waiting');
      const payload = await transport.receive(signal);
      const envelope = JSON.parse(Buffer.from(payload).toString('utf8'));

      // Verificacion criptografica completa, SIN RED.
      const { verified, matched } = verifyVoucherForAny(envelope, identities);

      setAmount(verified.amount);
      setPayer(verified.payer.toBase58());
      setPaidTo(matched);
      setLevel(verified.level);
      setState('verified');

      await enqueueVoucher({
        envelope,
        direction: 'received',
        receivedAt: new Date().toISOString(),
        attempts: 0,
      });

      // Lo que sabiamos de este billete de antes. Un pagador repetido vale mas que uno
      // desconocido, y eso se puede decir sin cobertura.
      const cached = readSlotCheck(ledger, verified.slot.toBase58());
      if (cached?.funded && Date.now() - Date.parse(cached.at) < CHECK_FRESH_MS) {
        setLevel(VerificationLevel.CACHED_STATE);
        setCheckedAt(cached.at);
      }

      if (!(await isOnline())) return;

      // Con red, lo primero es mirar el colateral: es mas rapido que liquidar y ya
      // responde la pregunta que de verdad importa — si hay dinero detras del billete.
      const funded = await checkSlotFunded(connection(), verified.slot);
      await writeSlotCheck(verified.slot.toBase58(), funded.exists);
      if (!funded.exists) {
        setError(
          'Este billete ya no existe en Solana: o se ha cobrado ya en otro pago, o nunca ' +
            'llego a existir. NO entregues nada.',
        );
        setState('error');
        return;
      }
      setLevel(VerificationLevel.CACHED_STATE);
      setCheckedAt(new Date().toISOString());

      // Y despues liquidar, que cierra la ventana de riesgo del todo.
      const { settled } = await drainSettlementQueue();
      if (settled > 0) setLevel(VerificationLevel.ONCHAIN_CONFIRMED);
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
          {toWallet
            ? `El cobro ira directo a tu wallet ${shortKey(payout.toBase58())}.`
            : 'Sin wallet conectada, el cobro queda en este movil y despues hay que pasarlo a tu wallet.'}
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
    const badge = LEVELS[level];
    return (
      <View style={styles.center}>
        <Text style={styles.bigCheck}>✓</Text>
        <Text style={styles.doneAmount}>${formatUsdc(amount)}</Text>
        <Text style={styles.centerText}>de {shortKey(payer)}</Text>

        <View style={[styles.badge, badge.style]}>
          <Text style={styles.badgeTitle}>{badge.title}</Text>
          <Text style={styles.badgeBody}>{badge.body}</Text>
          {checkedAt && level === VerificationLevel.CACHED_STATE && (
            <Text style={styles.badgeWhen}>Comprobado {when(checkedAt)}</Text>
          )}
        </View>

        {paidTo && (
          <Text style={styles.landed}>
            {paidTo.equals(deviceKey)
              ? 'Ha quedado en este movil. Pasalo a tu wallet desde la pantalla principal.'
              : `Ha ido directo a tu wallet ${shortKey(paidTo.toBase58())}.`}
          </Text>
        )}

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
      <Text style={styles.waitHint}>
        {toWallet
          ? `Ira directo a tu wallet ${shortKey(payout.toBase58())}.`
          : 'Conecta tu wallet y el cobro ira directo a ella, sin traspasos.'}
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

/**
 * Lo que significa cada nivel, en el idioma de quien esta cobrando.
 *
 * Nada de «CRYPTO_ONLY»: lo que le importa a alguien detras de un mostrador es si puede
 * entregar la mercancia, y la respuesta honesta a eso no siempre es «si».
 */
const LEVELS: Record<VerificationLevel, { title: string; body: string; style: object }> = {
  [VerificationLevel.CRYPTO_ONLY]: {
    title: 'Firma verificada',
    body:
      'El pago es autentico y solo se puede cobrar tu. Sin cobertura no se puede ' +
      'comprobar que el billete siga teniendo dinero detras: para importes grandes, ' +
      'espera a tener red.',
    style: { backgroundColor: 'rgba(255,176,32,0.12)' },
  },
  [VerificationLevel.CACHED_STATE]: {
    title: 'Firma verificada · billete con fondos',
    body:
      'Ademas de la firma, hemos visto en Solana que el billete tenia su dinero ' +
      'reservado. Falta que la transaccion se confirme.',
    style: { backgroundColor: 'rgba(255,176,32,0.12)' },
  },
  [VerificationLevel.ONCHAIN_CONFIRMED]: {
    title: 'Cobrado y confirmado en Solana',
    body: 'El dinero es tuyo y esta en la cadena. No queda nada pendiente.',
    style: { backgroundColor: 'rgba(20,241,149,0.12)' },
  },
};

function when(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  return `hace ${Math.round(mins / 60)} h`;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(4) },
  title: { color: theme.text, fontSize: 28, fontWeight: '700', marginBottom: spacing(2) },
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
  badge: {
    borderRadius: 12,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
    marginTop: spacing(3),
  },
  badgeTitle: { color: theme.text, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  badgeBody: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing(1),
  },
  badgeWhen: {
    color: theme.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing(1),
    fontStyle: 'italic',
  },
  landed: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing(2),
  },
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
  error: {
    color: theme.danger,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing(2),
    lineHeight: 20,
  },
});
