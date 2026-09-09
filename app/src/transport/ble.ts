/**
 * Transporte BLE. El caballo de batalla.
 *
 * El pagador anuncia un servicio GATT con una caracteristica que contiene el voucher.
 * El receptor escanea, conecta y lee. Se trocea porque el MTU de BLE ronda los 512B
 * y el voucher son ~800B en base64.
 *
 * ESTADO: esqueleto. Se completa en el spike del dia 1-4 (ROADMAP fase 0).
 *
 * Aviso importante: react-native-ble-plx solo hace de CENTRAL. Para el modo PERIPHERAL
 * (anunciar) hace falta un modulo nativo aparte. Si eso se atasca, la alternativa es
 * invertir los papeles: que el RECEPTOR anuncie y el PAGADOR escanee y escriba en su
 * caracteristica. Esa inversion es probablemente el camino correcto y hay que
 * decidirlo en el spike, no en la semana 3.
 */
import { BleManager, Device, State } from 'react-native-ble-plx';
import { Transport } from './types';

/** UUID propio. Generado una vez, fijo para toda la app. */
export const NONCEPAY_SERVICE_UUID = '4e4f4e43-4550-4159-0000-000000000001';
export const VOUCHER_CHARACTERISTIC_UUID = '4e4f4e43-4550-4159-0000-000000000002';

const CHUNK_SIZE = 180; // conservador; el MTU negociado suele dar mas

export class BleTransport implements Transport {
  readonly id = 'ble' as const;
  readonly label = 'Bluetooth';
  readonly maxPayload = 8 * 1024;

  private manager = new BleManager();
  private connected?: Device;

  async isAvailable() {
    const state = await this.manager.state();
    if (state !== State.PoweredOn) {
      return { available: false, reason: `Bluetooth ${state}` };
    }
    return { available: true };
  }

  /**
   * TODO(spike dia 1-4): modo peripheral.
   *
   * react-native-ble-plx no anuncia. Opciones, en orden de preferencia:
   *   1. Invertir papeles: el receptor anuncia, el pagador escanea y escribe.
   *   2. Modulo nativo propio con BluetoothLeAdvertiser (~150 lineas de Kotlin).
   *   3. Descartar BLE y quedarse con QR.
   */
  async send(payload: Uint8Array, signal?: AbortSignal): Promise<void> {
    const device = await this.scanForPeer(signal);
    await device.connect();
    await device.discoverAllServicesAndCharacteristics();
    await device.requestMTU(247).catch(() => undefined);

    for (const chunk of chunked(payload, CHUNK_SIZE)) {
      if (signal?.aborted) throw new Error('Envio cancelado');
      await device.writeCharacteristicWithResponseForService(
        NONCEPAY_SERVICE_UUID,
        VOUCHER_CHARACTERISTIC_UUID,
        Buffer.from(chunk).toString('base64'),
      );
    }
    this.connected = device;
  }

  async receive(_signal?: AbortSignal): Promise<Uint8Array> {
    throw new Error(
      'BLE peripheral pendiente del spike. Usa QrTransport mientras tanto.',
    );
  }

  private scanForPeer(signal?: AbortSignal): Promise<Device> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.manager.stopDeviceScan();
        reject(new Error('No se encontro ningun dispositivo cerca'));
      }, 15_000);

      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        this.manager.stopDeviceScan();
        reject(new Error('Busqueda cancelada'));
      });

      this.manager.startDeviceScan([NONCEPAY_SERVICE_UUID], null, (err, device) => {
        if (err) {
          clearTimeout(timeout);
          this.manager.stopDeviceScan();
          reject(err);
          return;
        }
        if (device) {
          clearTimeout(timeout);
          this.manager.stopDeviceScan();
          resolve(device);
        }
      });
    });
  }

  async stop(): Promise<void> {
    this.manager.stopDeviceScan();
    if (this.connected) {
      await this.connected.cancelConnection().catch(() => undefined);
      this.connected = undefined;
    }
  }
}

function* chunked(data: Uint8Array, size: number): Generator<Uint8Array> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}
