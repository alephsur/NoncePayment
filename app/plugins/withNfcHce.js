/**
 * Expo config plugin for Host Card Emulation (HCE).
 *
 * Expo does NOT support HCE out of the box — it is still an open feature request:
 * https://expo.canny.io/feature-requests/p/nfc-host-based-card-emulation
 *
 * This plugin injects what react-native-hce needs into the native Android project:
 *   1. NFC permissions and features
 *   2. the <service> declaration for the HostApduService
 *   3. the res/xml/aid_list.xml resource with our AIDs
 *
 * Requires prebuild + a development build. THIS DOES NOT WORK IN EXPO GO.
 */
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * NoncePayment's proprietary AID (Application Identifier).
 * The F0-FF range is proprietary space and needs no ISO/IEC 7816-5 registration.
 */
const NONCEPAY_AID = 'F04E4F4E4345504159';

/**
 * AID of the NDEF Tag Type 4 application (NFC Forum). It is the only one react-native-hce
 * can answer: its NFCTagType4 only accepts the SELECT for this AID. Without it in
 * aid_list.xml, Android never routes the tap to our service and the reader sees nothing —
 * the hardware would work and the spike would fail anyway.
 *
 * Ours stays registered for when there is a protocol of our own on raw APDUs.
 */
const NDEF_TAG_AID = 'D2760000850101';

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
    // BLE: the main transport. Android 12+ splits scan/connect/advertise.
    addPermission('android.permission.BLUETOOTH_SCAN');
    addPermission('android.permission.BLUETOOTH_CONNECT');
    addPermission('android.permission.BLUETOOTH_ADVERTISE');
    addPermission('android.permission.ACCESS_FINE_LOCATION');

    const addFeature = (name) => {
      if (!manifest.manifest['uses-feature'].some((f) => f.$['android:name'] === name)) {
        // required=false so devices without NFC are not excluded from the dApp Store:
        // the app is still usable over BLE and QR.
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
        <aid-filter android:name="${NDEF_TAG_AID}" />
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
module.exports.NDEF_TAG_AID = NDEF_TAG_AID;
