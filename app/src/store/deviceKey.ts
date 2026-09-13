/**
 * The device key.
 *
 * This is the piece that makes offline payment possible at all. Rather than hoping
 * Mobile Wallet Adapter can sign in airplane mode — an app switch to a wallet that may
 * not even come up without a network — we generate a keypair on the phone, keep it in
 * the Android Keystore behind the user's biometrics, and authorise it on chain as the
 * delegated signer of each banknote. See docs/ARCHITECTURE.md §2.3.
 *
 * It is a session-key pattern. The real wallet (Seed Vault) only ever acts ONLINE, to
 * fund. The device key can only spend what is already locked in slots, never the
 * balance. The blast radius is bounded by design.
 *
 * ## Two slots, and why
 *
 * The secret lives in an authenticated Keystore entry: `requireAuthentication: true`
 * means Android refuses to hand back the plaintext until a Class 3 biometric has been
 * presented *for this decryption*. The gate is the cipher, not an `if`.
 *
 * That makes the secret unreadable at rest, which is the point — and also unreadable
 * when all we want is to draw the address on screen. So the public half plus a little
 * metadata goes in a second, unauthenticated entry. The UI reads that one: no prompt,
 * no network, works in airplane mode with the phone half asleep.
 *
 * ## The trap this layout exists to catch
 *
 * When the user enrols a new fingerprint, Android **permanently invalidates** every key
 * bound to biometrics. `getItemAsync` then returns `null` — not an error, `null`, the
 * same answer it gives for a key that was never created. A single-slot design cannot
 * tell those apart, so it would quietly generate a fresh keypair and orphan every
 * loaded banknote: the on-chain slots still name the old signer, and the money would sit
 * there unspendable until someone thought to `reclaim` it.
 *
 * With the identity record present and the secret gone, the difference is obvious, and
 * we can say the true thing to the user instead of losing their money politely.
 */
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { Keypair, PublicKey } from '@solana/web3.js';

import { readBiometricCapability } from './biometrics';

/** The secret. Authenticated entry: reading it costs a biometric, every time. */
const SECRET_SLOT = 'noncepay.device_key.v1';
/** The public half. Unauthenticated, so the UI can render with no prompt. */
const IDENTITY_SLOT = 'noncepay.device_key_id.v1';

export type KeyProtection =
  /** The Keystore itself withholds the secret until a Class 3 biometric is presented. */
  | 'keystore_biometric'
  /** No strong sensor. The secret is encrypted at rest and gated by us, not by hardware. */
  | 'lockscreen_only';

export interface DeviceKeyIdentity {
  publicKey: PublicKey;
  protection: KeyProtection;
  /** ISO 8601. Shown in the UI; also tells you which key an old banknote belongs to. */
  createdAt: string;
}

export type DeviceKeyErrorCode =
  /** The user dismissed the biometric prompt. Not an error, a decision. */
  | 'CANCELLED'
  /** No key has been created on this phone yet. */
  | 'NO_KEY'
  /** The identity record survives but the Keystore threw the secret away. */
  | 'INVALIDATED'
  /** The stored secret is not the key the identity record names. */
  | 'MISMATCH'
  /** Biometrics were removed after the key was created, so nothing can unlock it. */
  | 'BIOMETRICS_GONE'
  /** A prompt is already up, or the app is not in the foreground. */
  | 'BUSY'
  /** SecureStore is not usable on this device at all. */
  | 'UNAVAILABLE';

export class DeviceKeyError extends Error {
  constructor(
    message: string,
    readonly code: DeviceKeyErrorCode,
  ) {
    super(message);
    this.name = 'DeviceKeyError';
  }
}

interface StoredIdentity {
  pubkey: string;
  protection: KeyProtection;
  createdAt: string;
}

/**
 * Reads the public half. No prompt, no network, never throws.
 *
 * `null` means no key has ever been created here. It does NOT mean the secret is
 * readable — only an actual unlock can tell you that.
 */
export async function readDeviceKeyIdentity(): Promise<DeviceKeyIdentity | null> {
  try {
    const raw = await SecureStore.getItemAsync(IDENTITY_SLOT, {
      requireAuthentication: false,
    });
    if (!raw) return null;
    const stored: StoredIdentity = JSON.parse(raw);
    return {
      publicKey: new PublicKey(stored.pubkey),
      protection: stored.protection,
      createdAt: stored.createdAt,
    };
  } catch {
    // Corrupt or unreadable. Treated as "no key": the setup flow will offer to create
    // one, which is recoverable, where crashing on launch is not.
    return null;
  }
}

/**
 * Generates the device key and stores it.
 *
 * On a phone with a strong sensor this prompts: Android requires authentication to use
 * the freshly generated Keystore key even for the *write*. That prompt is a feature —
 * it is the user's first sight of the gate that will protect their money, at the moment
 * they are deliberately setting it up.
 *
 * Refuses to run if a key already exists, unless `replace` is set. Overwriting is how
 * banknotes get orphaned, so it has to be asked for by name.
 */
export async function createDeviceKey(
  options: { replace?: boolean } = {},
): Promise<DeviceKeyIdentity> {
  const existing = await readDeviceKeyIdentity();
  if (existing && !options.replace) return existing;

  if (options.replace) {
    // An invalidated Keystore entry blocks writes until it is gone. Clear both slots so
    // a half-written state can never look like a usable key.
    await wipeDeviceKey();
  }

  const capability = await readBiometricCapability();
  const protection: KeyProtection =
    capability.keystoreBound && capability.enrolled ? 'keystore_biometric' : 'lockscreen_only';

  const keypair = Keypair.generate();

  // Secret first, identity second. If the user cancels the prompt we are left with no
  // identity record, which reads as "no key yet" — the one wrong state that is harmless.
  try {
    await SecureStore.setItemAsync(SECRET_SLOT, encodeSecret(keypair.secretKey), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: protection === 'keystore_biometric',
      authenticationPrompt: `Crear la clave de pago de este movil`,
    });
  } catch (e) {
    throw translate(e);
  }

  const stored: StoredIdentity = {
    pubkey: keypair.publicKey.toBase58(),
    protection,
    createdAt: new Date().toISOString(),
  };
  try {
    await SecureStore.setItemAsync(IDENTITY_SLOT, JSON.stringify(stored), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    });
  } catch (e) {
    // A secret nobody can name is worse than no secret: it would be invisible to the
    // UI and impossible to spend. Take it back out.
    await wipeDeviceKey();
    throw translate(e);
  }

  return { ...stored, publicKey: keypair.publicKey };
}

/** One unlock at a time. Two overlapping prompts make the native module throw. */
let inFlight: Promise<Keypair> | null = null;

/**
 * Returns the device key after the biometric gate.
 *
 * Call it ONLY immediately before signing. This is the "confirm with your fingerprint"
 * moment, and it is what stops somebody who picks up your unlocked phone from emptying
 * the banknotes — the claim docs/THREAT-MODEL.md §4 makes about a stolen unlocked phone.
 *
 * `reason` becomes the title of the system prompt, so make it say what is about to
 * happen — "Pagar $5.00", not "Autenticar".
 */
export async function unlockDeviceKey(reason = 'Confirmar pago'): Promise<Keypair> {
  if (inFlight) return inFlight;
  inFlight = unlockOnce(reason).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function unlockOnce(reason: string): Promise<Keypair> {
  const identity = await readDeviceKeyIdentity();
  if (!identity) {
    throw new DeviceKeyError('Este movil no tiene clave de pago todavia', 'NO_KEY');
  }

  // Without a strong sensor the Keystore cannot hold the gate, so we hold it. Weaker —
  // it is a check on a boolean rather than on a cipher — but it still costs an attacker
  // the user's fingerprint or PIN, and the UI says which of the two protections is live.
  if (identity.protection === 'lockscreen_only') {
    try {
      await softGate(reason);
    } catch (e) {
      throw translate(e);
    }
  }

  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(SECRET_SLOT, {
      requireAuthentication: identity.protection === 'keystore_biometric',
      authenticationPrompt: reason,
    });
  } catch (e) {
    throw translate(e);
  }

  if (raw === null) {
    // The identity record says a key exists. The Keystore disagrees. That only happens
    // when Android invalidated it — new fingerprint enrolled, or the app reinstalled.
    throw new DeviceKeyError(
      'Android ha destruido la clave de este movil (has cambiado la huella o reinstalado la app). ' +
        'Los billetes cargados solo se pueden recuperar con conexion.',
      'INVALIDATED',
    );
  }

  const keypair = Keypair.fromSecretKey(decodeSecret(raw));
  if (!keypair.publicKey.equals(identity.publicKey)) {
    // Should be impossible. If it ever happens, signing would produce vouchers against
    // a signer the on-chain slot does not authorise, and every one of them would fail
    // at settlement — after the recipient had already handed over the goods.
    throw new DeviceKeyError(
      'La clave guardada no coincide con la registrada en este movil',
      'MISMATCH',
    );
  }
  return keypair;
}

/**
 * Exercises the gate and throws the secret away.
 *
 * Exists so the user — and we, on a real phone — can confirm the fingerprint prompt
 * works before there is money behind it, and so an invalidated key is discovered while
 * standing next to a router rather than at the counter of a shop with no coverage.
 */
export async function testDeviceKeyGate(): Promise<void> {
  await unlockDeviceKey('Comprobar el bloqueo de pagos');
}

/**
 * Destroys the key.
 *
 * Any banknote already loaded against it becomes unspendable offline — it can only be
 * recovered online, by the owner's wallet calling `reclaim`. The UI must say so before
 * calling this.
 */
export async function wipeDeviceKey(): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_SLOT, { requireAuthentication: false });
  await SecureStore.deleteItemAsync(IDENTITY_SLOT, { requireAuthentication: false });
}

/** The gate we hold ourselves when the hardware will not. */
async function softGate(reason: string): Promise<void> {
  const capability = await readBiometricCapability();
  if (!capability.hasHardware || !capability.enrolled) {
    // Nothing to ask for. The secret store already requires an unlocked device, and the
    // UI carries a standing warning that this phone cannot protect payments properly.
    return;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancelar',
    disableDeviceFallback: false,
  });
  if (!result.success) {
    throw new DeviceKeyError('Autenticacion cancelada', 'CANCELLED');
  }
}

const SECRET_BYTES = 64;

function encodeSecret(secretKey: Uint8Array): string {
  return Buffer.from(secretKey).toString('base64');
}

function decodeSecret(raw: string): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(raw, 'base64'));
  if (bytes.length !== SECRET_BYTES) {
    throw new DeviceKeyError('La clave guardada esta corrupta', 'MISMATCH');
  }
  return bytes;
}

/**
 * Native errors arrive as opaque strings.
 *
 * The four that matter are the four the UI has different answers for: the user said no,
 * the sensor is gone, a prompt is already up, or the store itself is unusable. Anything
 * else keeps its original text — vague beats ugly right up until you are debugging on a
 * phone, and then it does not.
 */
function translate(e: unknown): DeviceKeyError {
  if (e instanceof DeviceKeyError) return e;
  const raw = String((e as any)?.message ?? e);

  if (/cancel/i.test(raw)) {
    return new DeviceKeyError('Autenticacion cancelada', 'CANCELLED');
  }
  if (/no biometrics are currently enrolled|no hardware available|unsupported/i.test(raw)) {
    return new DeviceKeyError(
      'Este movil ya no tiene biometria configurada, asi que la clave de pago no se puede desbloquear',
      'BIOMETRICS_GONE',
    );
  }
  if (/already in progress|not in the foreground/i.test(raw)) {
    return new DeviceKeyError('Ya hay una confirmacion abierta', 'BUSY');
  }
  if (/permanently invalidated/i.test(raw)) {
    return new DeviceKeyError(
      'Android ha destruido la clave de este movil. Hay que generar una nueva.',
      'INVALIDATED',
    );
  }
  return new DeviceKeyError(raw, 'UNAVAILABLE');
}
