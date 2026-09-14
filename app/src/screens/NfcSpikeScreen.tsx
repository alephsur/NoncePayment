/**
 * SPIKE 03 — Can bytes move over NFC HCE between two real phones?
 *
 * Throwaway code, like every spike: not refactored, not integrated. It exists to answer
 * the day-4 question and decide whether NFC lives or gets buried.
 *
 * Both roles live on the same screen: one phone taps "Emular" and the other "Leer en
 * bucle". Swapping roles is just tapping the other button on each phone.
 *
 * How to compare: both sides show the payload's fingerprint (truncated SHA-256). If they
 * match, the bytes arrived intact. The reader also counts how many reads in the series
 * were identical to each other, so nobody has to check the fingerprint on every tap.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Keypair } from '@solana/web3.js';

import { NfcTransport, encodeHandshake } from '../transport/nfc';
import { NONCEPAY_SERVICE_UUID } from '../transport/ble';
import { theme, spacing } from '../ui/theme';

type Mode = 'raw32' | 'handshake';
type Role = 'idle' | 'emitting' | 'reading';

interface Props {
  onDone: () => void;
}

/** Pause after each read: without it, phones still held together get read twice. */
const REARM_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const clock = () => new Date().toLocaleTimeString('es-ES', { hour12: false });

async function fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  return hex(digest.slice(0, 6)).match(/.{4}/g)!.join(' ');
}

function makePayload(mode: Mode): Uint8Array {
  if (mode === 'raw32') return Crypto.getRandomBytes(32);
  // The real handshake, at its real size: this is what will travel in the product.
  return encodeHandshake({
    sessionId: hex(Crypto.getRandomBytes(32)),
    bleServiceUuid: NONCEPAY_SERVICE_UUID,
    recipient: Keypair.generate().publicKey.toBase58(),
  });
}

export function NfcSpikeScreen({ onDone }: Props) {
  const transport = useRef(new NfcTransport()).current;
  const abort = useRef<AbortController | null>(null);

  const [availability, setAvailability] = useState('Comprobando NFC...');
  const [mode, setMode] = useState<Mode>('raw32');
  const [role, setRole] = useState<Role>('idle');
  const [log, setLog] = useState<string[]>([]);

  // Emitter
  const [sent, setSent] = useState<{ bytes: Uint8Array; print: string } | null>(null);
  const [sendCount, setSendCount] = useState(0);

  // Reader
  const [reads, setReads] = useState<string[]>([]);
  const [lastRead, setLastRead] = useState<{ bytes: Uint8Array; print: string } | null>(null);
  const [errors, setErrors] = useState(0);
  const [readerHint, setReaderHint] = useState('');

  const push = (line: string) => setLog((l) => [`${clock()}  ${line}`, ...l].slice(0, 20));

  useEffect(() => {
    transport.isAvailable().then(({ available, reason }) =>
      setAvailability(available ? 'NFC activo' : `NFC no disponible: ${reason}`),
    );
    return () => {
      abort.current?.abort();
      transport.stop();
    };
  }, [transport]);

  /** Raw HCE service events: connected / read / disconnected. Informational only. */
  useEffect(() => {
    if (role !== 'emitting') return;
    // on(null) does not say which event fired, so one subscription per event.
    const offs: (() => void)[] = [];
    let cancelled = false;
    const { HCESession } = require('react-native-hce');
    HCESession.getInstance().then((s: any) => {
      if (cancelled) return;
      const E = HCESession.Events;
      offs.push(s.on(E.HCE_STATE_CONNECTED, () => push('HCE: lector conectado (SELECT ok)')));
      offs.push(s.on(E.HCE_STATE_READ, () => push('HCE: READ')));
      offs.push(s.on(E.HCE_STATE_DISCONNECTED, () => push('HCE: desconectado')));
    });
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
    };
  }, [role]);

  async function stopAll() {
    abort.current?.abort();
    abort.current = null;
    await transport.stop();
    setRole('idle');
    setReaderHint('');
    push('Parado');
  }

  async function emit() {
    const controller = new AbortController();
    abort.current = controller;

    const bytes = makePayload(mode);
    const print = await fingerprint(bytes);
    setSent({ bytes, print });
    setSendCount(0);
    setRole('emitting');
    push(`Emulando ${bytes.length} B · huella ${print}`);

    try {
      // Same payload for the whole series: that way the reader can check all its reads
      // are identical without anyone looking at the screen on every tap.
      while (!controller.signal.aborted) {
        await transport.send(bytes, controller.signal);
        setSendCount((n) => n + 1);
        push('Leido por un lector y separado');
      }
    } catch (e: any) {
      if (!controller.signal.aborted) {
        push(`Error emulando: ${e?.message ?? e}`);
        await stopAll();
      }
    }
  }

  async function readLoop() {
    const controller = new AbortController();
    abort.current = controller;

    setReads([]);
    setLastRead(null);
    setErrors(0);
    setRole('reading');
    push('Lector armado');

    while (!controller.signal.aborted) {
      setReaderHint('Acerca el otro movil');
      try {
        const bytes = await transport.receive(controller.signal);
        const print = await fingerprint(bytes);
        setLastRead({ bytes, print });
        setReads((r) => [...r, print]);
        push(`Leidos ${bytes.length} B · huella ${print}`);
      } catch (e: any) {
        if (controller.signal.aborted) break;
        setErrors((n) => n + 1);
        push(`Error leyendo: ${e?.message ?? e}`);
      }
      setReaderHint('Separa los moviles');
      await sleep(REARM_DELAY_MS);
    }
  }

  const identical = reads.filter((p) => p === reads[0]).length;
  const busy = role !== 'idle';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable onPress={async () => { await stopAll(); onDone(); }}>
        <Text style={styles.back}>‹ Volver</Text>
      </Pressable>

      <Text style={styles.title}>Spike 03 · NFC HCE</Text>
      <Text style={styles.muted}>{availability}</Text>

      <Text style={styles.section}>Payload</Text>
      <View style={styles.row}>
        {(['raw32', 'handshake'] as Mode[]).map((m) => (
          <Pressable
            key={m}
            disabled={busy}
            onPress={() => setMode(m)}
            style={[styles.chip, mode === m && styles.chipOn, busy && styles.dim]}
          >
            <Text style={mode === m ? styles.chipTextOn : styles.chipText}>
              {m === 'raw32' ? '32 B aleatorios' : 'Handshake real'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.row}>
        <Pressable
          disabled={role === 'reading'}
          onPress={role === 'emitting' ? stopAll : emit}
          style={[styles.button, role === 'emitting' ? styles.stop : styles.primary, role === 'reading' && styles.dim]}
        >
          <Text style={styles.buttonText}>{role === 'emitting' ? 'Parar' : 'Emular'}</Text>
        </Pressable>
        <Pressable
          disabled={role === 'emitting'}
          onPress={role === 'reading' ? stopAll : readLoop}
          style={[styles.button, role === 'reading' ? styles.stop : styles.secondary, role === 'emitting' && styles.dim]}
        >
          <Text style={styles.buttonText}>{role === 'reading' ? 'Parar' : 'Leer en bucle'}</Text>
        </Pressable>
      </View>

      {role === 'emitting' && sent && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Emitiendo · {sent.bytes.length} B</Text>
          <Text style={styles.print}>{sent.print}</Text>
          {sent.bytes.length === 32 && <Text style={styles.hex}>{hex(sent.bytes)}</Text>}
          <Text style={styles.muted}>Lecturas completas: {sendCount}</Text>
          <Text style={styles.hint}>
            Pantalla desbloqueada. Puedes salir con Home para la prueba en segundo plano.
          </Text>
        </View>
      )}

      {(role === 'reading' || reads.length > 0 || errors > 0) && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Lector</Text>
          {role === 'reading' && <Text style={styles.hint}>{readerHint}</Text>}
          <Text style={styles.print}>{lastRead?.print ?? '—'}</Text>
          {lastRead?.bytes.length === 32 && <Text style={styles.hex}>{hex(lastRead.bytes)}</Text>}
          <Text style={styles.stat}>
            OK: {reads.length} · errores: {errors} · identicas a la 1ª: {identical}/{reads.length}
          </Text>
        </View>
      )}

      <Text style={styles.section}>Registro</Text>
      <View style={styles.card}>
        {log.length === 0 ? (
          <Text style={styles.muted}>Nada todavia</Text>
        ) : (
          log.map((line, i) => (
            <Text key={i} style={styles.logLine}>{line}</Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing(3), paddingBottom: spacing(6) },
  back: { color: theme.accent, fontSize: 16, marginBottom: spacing(2) },
  title: { color: theme.text, fontSize: 26, fontWeight: '700' },
  muted: { color: theme.textMuted, fontSize: 13, marginTop: spacing(0.5) },
  section: {
    color: theme.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing(3),
    marginBottom: spacing(1),
  },
  row: { flexDirection: 'row', gap: spacing(1.5), marginBottom: spacing(1.5) },
  chip: {
    flex: 1,
    paddingVertical: spacing(1.25),
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipOn: { borderColor: theme.accent },
  chipText: { color: theme.textMuted, fontSize: 14 },
  chipTextOn: { color: theme.text, fontSize: 14, fontWeight: '600' },
  button: { flex: 1, paddingVertical: spacing(2), borderRadius: 14, alignItems: 'center' },
  primary: { backgroundColor: theme.accentAlt },
  secondary: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border },
  stop: { backgroundColor: theme.danger },
  dim: { opacity: 0.4 },
  buttonText: { color: theme.text, fontSize: 16, fontWeight: '700' },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing(2),
    marginTop: spacing(1),
    borderWidth: 1,
    borderColor: theme.border,
  },
  cardLabel: { color: theme.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  print: {
    color: theme.accent,
    fontSize: 30,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginVertical: spacing(1),
  },
  hex: { color: theme.text, fontSize: 12, fontFamily: 'monospace', marginBottom: spacing(1) },
  stat: { color: theme.text, fontSize: 15, fontWeight: '600', marginTop: spacing(0.5) },
  hint: { color: theme.warning, fontSize: 13, marginTop: spacing(0.5) },
  logLine: { color: theme.textMuted, fontSize: 12, fontFamily: 'monospace', marginBottom: 2 },
});
