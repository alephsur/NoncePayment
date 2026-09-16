/**
 * Lo que ha fallado, dicho en terminos de que hacer al respecto.
 *
 * La clave de dispositivo tiene fallos que no son fallos — una huella cancelada es una
 * decision — y uno que si es serio: una clave que Android ha destruido. Leidos por
 * alguien de pie en un mostrador son cosas muy distintas, asi que se dicen muy distinto.
 * Lo que no reconocemos conserva su texto original, porque vago solo es mejor que feo
 * hasta que estas depurando en un movil.
 *
 * El mensaje de cancelacion lo pone quien llama: en español no vale un texto generico
 * («pago cancelado» y «traspaso cancelado» concuerdan distinto), y es la frase que mas
 * se lee de las seis.
 */
import { DeviceKeyError } from '../store/deviceKey';

export function explainDeviceKeyError(e: unknown, cancelled: string): string {
  if (e instanceof DeviceKeyError) {
    switch (e.code) {
      case 'CANCELLED':
        return cancelled;
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
