/**
 * Config plugin de Expo para Host Card Emulation (HCE).
 *
 * Expo NO soporta HCE de serie — sigue siendo un feature request abierto:
 * https://expo.canny.io/feature-requests/p/nfc-host-based-card-emulation
 *
 * Este plugin inyecta lo que react-native-hce necesita en el proyecto Android nativo:
 *   1. permisos y features de NFC
 *   2. la declaracion del <service> del HostApduService
 *   3. el recurso res/xml/aid_list.xml con nuestro AID
 *
 * Requiere prebuild + development build. CON EXPO GO ESTO NO FUNCIONA.
 */
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * AID (Application Identifier) propietario de NoncePayment.
 * Rango F0-FF = espacio propietario, no necesita registro en ISO/IEC 7816-5.
 */
const NONCEPAY_AID = 'F04E4F4E4345504159';

const HCE_SERVICE = 'com.reactnativehce.services.CardService';

function withNfcPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;

    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    manifest.manifest['uses-feature'] = manifest.manifest['uses-feature'] || [];

    const addPermission = (name) => {
      if (!manifest.manifest['uses-permission'].some((p) => p.$['android:name'] === name)) {
        manifest.manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    };

    addPermission('android.permission.NFC');
    // BLE: el transporte principal. Android 12+ separa scan/connect/advertise.
    addPermission('android.permission.BLUETOOTH_SCAN');
    addPermission('android.permission.BLUETOOTH_CONNECT');
    addPermission('android.permission.BLUETOOTH_ADVERTISE');
    addPermission('android.permission.ACCESS_FINE_LOCATION');

    const addFeature = (name) => {
      if (!manifest.manifest['uses-feature'].some((f) => f.$['android:name'] === name)) {
        // required=false para no excluir dispositivos sin NFC del dApp Store:
        // la app sigue siendo usable via BLE y QR.
        manifest.manifest['uses-feature'].push({
          $: { 'android:name': name, 'android:required': 'false' },
        });
      }
    };

    addFeature('android.hardware.nfc');
    addFeature('android.hardware.nfc.hce');

    return cfg;
  });
}

function withHceService(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = app.service || [];

    if (app.service.some((s) => s.$['android:name'] === HCE_SERVICE)) return cfg;

    app.service.push({
      $: {
        'android:name': HCE_SERVICE,
        'android:exported': 'true',
        'android:permission': 'android.permission.BIND_NFC_SERVICE',
      },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': 'android.nfc.cardemulation.action.HOST_APDU_SERVICE' } },
          ],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        },
      ],
      'meta-data': [
        {
          $: {
            'android:name': 'android.nfc.cardemulation.host_apdu_service',
            'android:resource': '@xml/aid_list',
          },
        },
      ],
    });

    return cfg;
  });
}

function withAidList(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const xmlDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/res/xml',
      );
      fs.mkdirSync(xmlDir, { recursive: true });

      const contents = `<?xml version="1.0" encoding="utf-8"?>
<host-apdu-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/app_name"
    android:requireDeviceUnlock="true"
    android:apduServiceBanner="@mipmap/ic_launcher">
    <aid-group
        android:description="@string/app_name"
        android:category="other">
        <aid-filter android:name="${NONCEPAY_AID}" />
    </aid-group>
</host-apdu-service>
`;
      fs.writeFileSync(path.join(xmlDir, 'aid_list.xml'), contents);
      return cfg;
    },
  ]);
}

module.exports = function withNfcHce(config) {
  config = withNfcPermissions(config);
  config = withHceService(config);
  config = withAidList(config);
  return config;
};

module.exports.NONCEPAY_AID = NONCEPAY_AID;
