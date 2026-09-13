/**
 * The device key, as the UI needs to see it.
 *
 * Everything the screens do with the key goes through here, for one reason: the only
 * way to learn that Android has invalidated the key is to try to unlock it and be
 * handed `null`. If PayScreen called the store directly, that discovery would die
 * inside a catch block in the middle of a payment and the home screen would go on
 * showing a key that no longer exists. Routing unlocks through the hook means the app
 * learns it once and every screen learns it at the same time.
 */
import { useCallback, useEffect, useState } from 'react';
import { Keypair } from '@solana/web3.js';

import { BiometricCapability, readBiometricCapability } from './biometrics';
import {
  DeviceKeyError,
  DeviceKeyIdentity,
  createDeviceKey,
  readDeviceKeyIdentity,
  unlockDeviceKey,
  wipeDeviceKey,
} from './deviceKey';

export type DeviceKeyPhase =
  /** Reading the identity record. A few milliseconds, no prompt. */
  | 'loading'
  /** No key on this phone. The user has to create one before anything else works. */
  | 'absent'
  /** A key exists and, as far as we know, can be unlocked. */
  | 'ready'
  /** The key existed and the Keystore threw it away. Loaded banknotes need `reclaim`. */
  | 'invalidated';

export interface DeviceKeyState {
  phase: DeviceKeyPhase;
  identity: DeviceKeyIdentity | null;
  capability: BiometricCapability | null;
  /** Something the user should read. Cleared on the next attempt. */
  error: string | null;
  /** A prompt is up or a key is being written. Disables the buttons. */
  busy: boolean;
  create: () => Promise<void>;
  /** Wipe and generate again. Only offered once the old key is known to be dead. */
  regenerate: () => Promise<void>;
  /** Exercise the gate with nothing at stake. Returns whether it opened. */
  test: () => Promise<boolean>;
  forget: () => Promise<void>;
  /** Unlock for signing. Throws; the caller decides what to say about it. */
  unlock: (reason: string) => Promise<Keypair>;
}

export function useDeviceKey(): DeviceKeyState {
  const [phase, setPhase] = useState<DeviceKeyPhase>('loading');
  const [identity, setIdentity] = useState<DeviceKeyIdentity | null>(null);
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setCapability(await readBiometricCapability());
      const stored = await readDeviceKeyIdentity();
      setIdentity(stored);
      setPhase(stored ? 'ready' : 'absent');
    })();
  }, []);

  /**
   * Anything that touches the Keystore reports back here.
   *
   * `INVALIDATED` is the one that changes the world rather than just the error line:
   * the key is gone for good, and the home screen has to stop pretending otherwise.
   */
  const absorb = useCallback((e: unknown) => {
    const err = e instanceof DeviceKeyError ? e : null;
    if (err?.code === 'INVALIDATED' || err?.code === 'MISMATCH') setPhase('invalidated');
    if (err?.code === 'NO_KEY') setPhase('absent');
    // A cancelled prompt is a decision, not a failure. Saying "error" about it makes the
    // app look broken when the user simply changed their mind.
    setError(err?.code === 'CANCELLED' ? null : String((e as any)?.message ?? e));
  }, []);

  const generate = useCallback(
    async (replace: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const created = await createDeviceKey({ replace });
        setIdentity(created);
        setPhase('ready');
        // The protection level is decided at creation time, so re-read what the phone
        // can do: the user may have enrolled a fingerprint since the app opened.
        setCapability(await readBiometricCapability());
      } catch (e) {
        absorb(e);
        // A replace wipes before it writes, so a cancelled prompt leaves no key at all.
        // Ask the store what is actually there rather than assuming the phase survived.
        const actual = await readDeviceKeyIdentity();
        setIdentity(actual);
        if (!actual) setPhase('absent');
      } finally {
        setBusy(false);
      }
    },
    [absorb],
  );

  const create = useCallback(() => generate(false), [generate]);
  const regenerate = useCallback(() => generate(true), [generate]);

  const unlock = useCallback(
    async (reason: string) => {
      setError(null);
      try {
        return await unlockDeviceKey(reason);
      } catch (e) {
        absorb(e);
        throw e;
      }
    },
    [absorb],
  );

  const test = useCallback(async () => {
    setBusy(true);
    try {
      await unlock('Comprobar el bloqueo de pagos');
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  const forget = useCallback(async () => {
    setBusy(true);
    try {
      await wipeDeviceKey();
      setIdentity(null);
      setPhase('absent');
      setError(null);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    phase,
    identity,
    capability,
    error,
    busy,
    create,
    regenerate,
    test,
    forget,
    unlock,
  };
}
