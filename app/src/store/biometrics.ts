/**
 * What this particular phone can actually do about biometrics.
 *
 * Two different questions hide behind "does it have a fingerprint reader", and the
 * device key depends on telling them apart:
 *
 *  1. Can we *show* a biometric prompt? — `expo-local-authentication`. This is a UI
 *     check. It says a fingerprint was read; nothing stops code from ignoring the answer.
 *  2. Can the **Keystore itself** refuse to decrypt without one? — that needs a
 *     Class 3 (BIOMETRIC_STRONG) sensor, because only a strong sensor is allowed to
 *     release a hardware-bound key. This is the real gate: the secret does not exist in
 *     usable form until the user authenticates.
 *
 * A phone can answer yes to (1) and no to (2) — a Class 2 face unlock is the usual case.
 * We store the key differently in each world and say so out loud in the UI, because
 * "protected by your fingerprint" and "protected by the lock screen" are not the same
 * promise and the threat model rests on which one is true.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

export interface BiometricCapability {
  /** There is a sensor of some kind. */
  hasHardware: boolean;
  /** The user has actually enrolled something in it. */
  enrolled: boolean;
  /** The Keystore can bind a key to it (Class 3). This is what makes the gate real. */
  keystoreBound: boolean;
  /** "huella", "rostro", "iris" or "biometria" — for the copy in prompts and warnings. */
  noun: string;
}

/** Nothing available: the honest answer when every probe says no or blows up. */
const NONE: BiometricCapability = {
  hasHardware: false,
  enrolled: false,
  keystoreBound: false,
  noun: 'biometria',
};

export async function readBiometricCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    return {
      hasHardware,
      enrolled,
      // Sync, and it throws on platforms without the native module rather than
      // returning false — hence the try/catch around the lot.
      keystoreBound: SecureStore.canUseBiometricAuthentication(),
      noun: nounFor(types),
    };
  } catch {
    return { ...NONE };
  }
}

/**
 * Which word to put in front of the user.
 *
 * Fingerprint wins ties: on a phone that has both, it is the one the prompt will offer
 * first, and naming the other one makes the instruction read as wrong.
 */
function nounFor(types: LocalAuthentication.AuthenticationType[]): string {
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'huella';
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'rostro';
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
  return 'biometria';
}
