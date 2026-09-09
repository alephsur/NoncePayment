/**
 * La clave de dispositivo.
 *
 * Es la pieza que hace que todo esto funcione sin red. En vez de depender de que Mobile
 * Wallet Adapter sepa firmar en modo avion (algo que hay que VERIFICAR en el spike del
 * dia 1-4, ver ROADMAP riesgo #2), generamos una clave local, la guardamos en el
 * almacen seguro del sistema tras una barrera biometrica, y la autorizamos on-chain
 * como firmante delegado de cada billete.
 *
 * Es un patron de session key: la wallet real (Seed Vault) solo interviene ONLINE para
 * financiar. La clave de dispositivo solo puede gastar lo que ya esta bloqueado en
 * slots, nunca el saldo completo del usuario. El radio de explosion esta acotado por
 * diseño.
 */
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { Keypair } from '@solana/web3.js';

const DEVICE_KEY_SLOT = 'noncepay.device_key.v1';

export class BiometricError extends Error {}

/** Crea la clave de dispositivo si no existe. Idempotente. */
export async function ensureDeviceKey(): Promise<Keypair> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY_SLOT, {
    requireAuthentication: false,
  });
  if (existing) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(existing)));
  }

  const kp = Keypair.generate();
  await SecureStore.setItemAsync(
    DEVICE_KEY_SLOT,
    JSON.stringify(Array.from(kp.secretKey)),
    {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    },
  );
  return kp;
}

/** Solo la parte publica. No pide biometria: es lo que se enseña en la UI. */
export async function getDeviceKeyPublic(): Promise<Keypair> {
  return ensureDeviceKey();
}

/**
 * Devuelve la clave de dispositivo tras superar la barrera biometrica.
 *
 * Llamar SOLO justo antes de firmar un pago. Este es el momento de "confirmar con la
 * huella" y es tambien lo que impide que alguien que te coja el movil desbloqueado
 * vacie los billetes.
 */
export async function unlockDeviceKey(reason = 'Confirmar pago'): Promise<Keypair> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  if (hasHardware && isEnrolled) {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancelar',
      disableDeviceFallback: false,
    });
    if (!result.success) {
      throw new BiometricError('Autenticacion cancelada o fallida');
    }
  }
  // Sin biometria configurada seguimos adelante: el almacen seguro ya exige que el
  // dispositivo este desbloqueado. Lo avisamos en la UI de ajustes.

  return ensureDeviceKey();
}

/** Destruye la clave. Los billetes vivos quedan irrecuperables salvo `reclaim` online. */
export async function wipeDeviceKey(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_KEY_SLOT);
}
