import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Ledger, availableNotes, receivedBalance, unspendableNotes } from '../store/ledger';
import { abandonedVouchers, retrySettlement } from '../net/settlement';
import { ReclaimStep, reclaimNotes } from '../net/reclaim';
import { DeviceKeyCard } from '../ui/DeviceKeyCard';
import { ReceivedCard } from '../ui/ReceivedCard';
import { WalletCard } from '../ui/WalletCard';
import { formatUsdc, shortKey } from '../ui/format';
import { theme, spacing } from '../ui/theme';
import type { DeviceKeyState } from '../store/useDeviceKey';
import type { WalletState } from '../wallet/useWallet';
import { PayScreen } from './PayScreen';
import { ReceiveScreen } from './ReceiveScreen';
import { NfcSpikeScreen } from './NfcSpikeScreen';
import { LoadScreen } from './LoadScreen';

type Tab = 'home' | 'pay' | 'receive' | 'load' | 'nfc-spike';

const RECLAIM_TEXT: Record<ReclaimStep, string> = {
  wallet: 'Aprueba el rescate en tu wallet...',
  sending: 'Enviando a Solana...',
  confirming: 'Esperando confirmacion...',
  syncing: 'Actualizando tus billetes...',
};

interface Props {
  ledger: Ledger;
  deviceKey: DeviceKeyState;
  wallet: WalletState;
  online: boolean;
  balance: bigint;
  /** A sync is in flight. Drives the pull-to-refresh spinner. */
  syncing: boolean;
  onRefresh: () => Promise<void>;
}

export function HomeScreen(props: Props) {
  const [tab, setTab] = useState<Tab>('home');
  const [retrying, setRetrying] = useState(false);
  const [reclaiming, setReclaiming] = useState<ReclaimStep | null>(null);
  const [reclaimError, setReclaimError] = useState<string | null>(null);

  // Nothing can be paid or charged without a device key: it is the signer of every
  // voucher and the address a recipient is named against. Until it exists the two
  // buttons are dead, and the card below says how to bring it to life.
  const identity = props.deviceKey.phase === 'ready' ? props.deviceKey.identity : null;
  const back = () => {
    setTab('home');
    props.onRefresh();
  };

  if (tab === 'pay' && identity) {
    return <PayScreen ledger={props.ledger} deviceKey={props.deviceKey} onDone={back} />;
  }
  if (tab === 'receive' && identity) {
    return (
      <ReceiveScreen
        deviceKey={identity.publicKey}
        wallet={props.wallet}
        online={props.online}
        ledger={props.ledger}
        onDone={back}
      />
    );
  }
  if (tab === 'load' && identity && props.wallet.session) {
    return <LoadScreen wallet={props.wallet} deviceKey={identity.publicKey} onDone={back} />;
  }
  // Spike 03: needs no device key and no banknotes, only NFC.
  if (tab === 'nfc-spike') {
    return <NfcSpikeScreen onDone={back} />;
  }

  const notes = availableNotes(props.ledger);
  const abandoned = abandonedVouchers(props.ledger.pending);
  const stuck = unspendableNotes(props.ledger);
  const received = receivedBalance(props.ledger);
  const pending = props.ledger.pending.filter((p) => !p.settledSignature);
  const canPay = notes.length > 0 && identity !== null;
  // Loading names the device key as the signer of every banknote, so it has to exist
  // first; and it is the one step that needs the network.
  const canLoad = identity !== null && props.online && props.wallet.session !== null;
  // Reclaim lo firma la wallet, no la clave del movil — de hecho se usa justo cuando esa
  // clave ya no sirve. Pero la clave tiene que existir para poder resincronizar despues.
  const canReclaim =
    identity !== null && props.online && props.wallet.session !== null && reclaiming === null;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={props.syncing}
          onRefresh={props.onRefresh}
          tintColor={theme.accent}
          colors={[theme.accent]}
        />
      }
    >
      <View style={styles.statusRow}>
        <View
          style={[
            styles.dot,
            { backgroundColor: props.online ? theme.accent : theme.warning },
          ]}
        />
        <Text style={styles.statusText}>
          {props.online ? 'Conectado' : 'Sin red — modo efectivo'}
        </Text>
      </View>

      <Text style={styles.label}>Efectivo disponible offline</Text>
      <Text style={styles.balance}>${formatUsdc(props.balance)}</Text>
      <Text style={styles.sub}>
        {notes.length} {notes.length === 1 ? 'billete' : 'billetes'} ·{' '}
        {identity
          ? `dispositivo ${shortKey(identity.publicKey.toBase58())}`
          : 'sin clave de dispositivo'}
      </Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, canPay ? styles.primary : styles.disabled]}
          onPress={() => setTab('pay')}
          disabled={!canPay}
        >
          <Text style={canPay ? styles.primaryText : styles.disabledText}>Pagar</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.secondary]}
          onPress={() => setTab('receive')}
          disabled={!identity}
        >
          <Text style={[styles.secondaryText, !identity && styles.disabledText]}>
            Cobrar
          </Text>
        </Pressable>
      </View>

      {received > 0n && (
        <>
          <Text style={styles.section}>Cobrado</Text>
          <ReceivedCard
            amount={received}
            wallet={props.wallet}
            deviceKey={props.deviceKey}
            online={props.online}
            onDone={props.onRefresh}
          />
        </>
      )}

      <Text style={styles.section}>Billetes</Text>
      {notes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No tienes billetes cargados. Conectate a internet y carga efectivo para poder
            pagar sin cobertura.
          </Text>
        </View>
      ) : (
        notes.map((n) => (
          <View key={n.index} style={styles.note}>
            <Text style={styles.noteAmount}>${formatUsdc(BigInt(n.amount))}</Text>
            <Text style={styles.noteMeta}>
              #{n.index} · nonce {shortKey(n.nonceAccount)}
            </Text>
          </View>
        ))
      )}

      {stuck.count > 0 && (
        <View style={styles.stuck}>
          <Text style={styles.stuckTitle}>
            {stuck.count} {stuck.count === 1 ? 'billete atrapado' : 'billetes atrapados'} ·
            ${formatUsdc(stuck.amount)}
          </Text>
          <Text style={styles.stuckBody}>
            Se cargaron con una clave de dispositivo anterior, asi que este movil ya no
            puede firmarlos. El dinero sigue siendo tuyo: recuperalo y volvera a tu
            wallet, listo para cargarlo otra vez.
          </Text>

          {reclaiming ? (
            <View style={styles.reclaimWorking}>
              <ActivityIndicator color={theme.accent} />
              <Text style={styles.reclaimWorkingText}>{RECLAIM_TEXT[reclaiming]}</Text>
            </View>
          ) : (
            <Pressable
              style={[styles.retryButton, !canReclaim && styles.disabled]}
              disabled={!canReclaim}
              onPress={async () => {
                setReclaimError(null);
                try {
                  await reclaimNotes({
                    deviceKey: identity!.publicKey,
                    indexes: stuck.notes.map((n) => n.index),
                    onStep: setReclaiming,
                  });
                  await props.onRefresh();
                } catch (e: any) {
                  setReclaimError(String(e?.message ?? e));
                } finally {
                  setReclaiming(null);
                }
              }}
            >
              <Text style={canReclaim ? styles.retryText : styles.disabledText}>
                {!props.online
                  ? 'Recuperar · sin red'
                  : !props.wallet.session
                    ? 'Recuperar · conecta la wallet'
                    : `Recuperar $${formatUsdc(stuck.amount)}`}
              </Text>
            </Pressable>
          )}

          <Text style={styles.stuckFoot}>
            Vuelve el USDC y la mayor parte de la renta. Unos 0.0014 SOL por billete se
            quedan en su nonce, que solo podia cerrar la clave que ya no existe.
          </Text>

          {reclaimError && <Text style={styles.reclaimError}>{reclaimError}</Text>}
        </View>
      )}

      <Text style={styles.section}>Wallet y recarga</Text>
      <WalletCard wallet={props.wallet} online={props.online} />
      {props.wallet.session && (
        <Pressable
          style={[styles.button, canLoad ? styles.primary : styles.disabled, styles.loadButton]}
          onPress={() => setTab('load')}
          disabled={!canLoad}
        >
          <Text style={canLoad ? styles.primaryText : styles.disabledText}>
            {!props.online
              ? 'Cargar billetes · sin red'
              : !identity
                ? 'Cargar billetes · crea antes la clave'
                : 'Cargar billetes'}
          </Text>
        </Pressable>
      )}

      <Text style={styles.section}>Dispositivo</Text>
      <DeviceKeyCard state={props.deviceKey} online={props.online} />

      {pending.length > 0 && (
        <>
          <Text style={styles.section}>Pendiente de liquidar</Text>
          {abandoned.length > 0 && identity && (
            <View style={styles.abandoned}>
              <Text style={styles.abandonedTitle}>
                {abandoned.length} sin liquidar tras varios intentos
              </Text>
              <Text style={styles.abandonedBody}>
                El dinero sigue reservado en Solana. Mientras el billete siga abierto el
                pago se puede cobrar, asi que vuelve a intentarlo cuando tengas buena
                cobertura.
              </Text>
              <Pressable
                style={[styles.retryButton, (!props.online || retrying) && styles.disabled]}
                disabled={!props.online || retrying}
                onPress={async () => {
                  setRetrying(true);
                  try {
                    await retrySettlement();
                    await props.onRefresh();
                  } finally {
                    setRetrying(false);
                  }
                }}
              >
                <Text style={props.online ? styles.retryText : styles.disabledText}>
                  {retrying ? 'Reintentando...' : props.online ? 'Reintentar' : 'Sin red'}
                </Text>
              </Pressable>
            </View>
          )}
          {pending.map((p, i) => (
            <View key={i} style={[styles.note, styles.notePending]}>
              <Text style={styles.noteAmount}>
                ${formatUsdc(BigInt(p.envelope.hint.amount))}
              </Text>
              <Text style={styles.noteMeta}>
                {p.direction === 'received' ? 'Recibido' : 'Enviado'} ·{' '}
                {p.attempts > 0 ? `${p.attempts} intentos` : 'esperando red'}
              </Text>
              {p.lastError?.startsWith('DOBLE GASTO') ? (
                <Text style={styles.fraud}>{p.lastError}</Text>
              ) : (
                p.lastError && <Text style={styles.noteMeta}>{p.lastError}</Text>
              )}
            </View>
          ))}
        </>
      )}

      <Pressable onPress={() => setTab('nfc-spike')} style={styles.spikeLink}>
        <Text style={styles.spikeLinkText}>Spike 03 · prueba NFC entre dos moviles</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing(3), paddingBottom: spacing(6) },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing(3) },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing(1) },
  statusText: { color: theme.textMuted, fontSize: 13 },
  label: { color: theme.textMuted, fontSize: 14 },
  balance: { color: theme.text, fontSize: 52, fontWeight: '700', letterSpacing: -1.5 },
  sub: { color: theme.textMuted, fontSize: 13, marginTop: spacing(0.5) },
  actions: { flexDirection: 'row', gap: spacing(1.5), marginVertical: spacing(3) },
  button: { flex: 1, paddingVertical: spacing(2), borderRadius: 14, alignItems: 'center' },
  primary: { backgroundColor: theme.accent },
  disabled: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border },
  disabledText: { color: theme.textMuted, fontSize: 16, fontWeight: '600' },
  primaryText: { color: '#04120C', fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border },
  loadButton: { flex: 0, marginBottom: spacing(1) },
  secondaryText: { color: theme.text, fontSize: 16, fontWeight: '600' },
  section: {
    color: theme.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing(2),
    marginBottom: spacing(1),
  },
  note: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing(2),
    marginBottom: spacing(1),
    borderWidth: 1,
    borderColor: theme.border,
  },
  notePending: { borderColor: theme.warning },
  abandoned: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing(2),
    marginBottom: spacing(1),
    borderWidth: 1,
    borderColor: theme.danger,
  },
  fraud: { color: theme.danger, fontSize: 12, lineHeight: 17, marginTop: spacing(1), fontWeight: '600' },
  abandonedTitle: { color: theme.danger, fontSize: 15, fontWeight: '700' },
  abandonedBody: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing(1) },
  retryButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
    marginTop: spacing(2),
  },
  retryText: { color: '#04120C', fontSize: 15, fontWeight: '700' },
  stuck: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing(2),
    marginTop: spacing(1),
    borderWidth: 1,
    borderColor: theme.warning,
  },
  stuckTitle: { color: theme.warning, fontSize: 15, fontWeight: '700' },
  stuckFoot: { color: theme.textMuted, fontSize: 11, lineHeight: 15, marginTop: spacing(1.5) },
  reclaimWorking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    marginTop: spacing(2),
  },
  reclaimWorkingText: { color: theme.text, fontSize: 13 },
  reclaimError: { color: theme.danger, fontSize: 12, lineHeight: 17, marginTop: spacing(1) },
  stuckBody: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing(1) },
  noteAmount: { color: theme.text, fontSize: 20, fontWeight: '600' },
  noteMeta: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
  empty: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing(2.5),
    borderWidth: 1,
    borderColor: theme.border,
  },
  emptyText: { color: theme.textMuted, fontSize: 14, lineHeight: 20 },
  spikeLink: { marginTop: spacing(4), alignItems: 'center', paddingVertical: spacing(1.5) },
  spikeLinkText: { color: theme.textMuted, fontSize: 13, textDecorationLine: 'underline' },
});
