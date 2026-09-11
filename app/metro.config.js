/**
 * Metro has to be told about the SDK.
 *
 * `@noncepayment/sdk` is a `file:` dependency, so npm links it as a symlink pointing
 * outside this project. Metro only watches the project root, so without this it bundles
 * 606 modules and then fails with "Unable to resolve @noncepayment/sdk" — which looks
 * like a broken install and isn't.
 *
 * `watchFolders` puts the SDK inside the watched set, and `nodeModulesPaths` lets its
 * imports resolve against both its own dependencies and the app's.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, '../packages/sdk');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [sdkRoot];

/*
 * Mobile Wallet Adapter ships its entry points through the `exports` field, including a
 * `./encoding` subpath that its own web3.js binding imports. Metro on SDK 52 ignores
 * `exports` unless this is on, and the failure is a bundling error that blames a file
 * deep inside node_modules rather than the config:
 *
 *   Unable to resolve module @solana-mobile/mobile-wallet-adapter-protocol/encoding
 *
 * `react-native` has to lead the condition list, or the package resolves to its browser
 * build and the native module is never reached.
 */
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'require', 'default'];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(sdkRoot, 'node_modules'),
];

// One copy of these, or `instanceof` checks fail across duplicated module instances.
config.resolver.extraNodeModules = {
  '@solana/web3.js': path.resolve(projectRoot, 'node_modules/@solana/web3.js'),
  '@solana/spl-token': path.resolve(projectRoot, 'node_modules/@solana/spl-token'),
  buffer: path.resolve(projectRoot, 'node_modules/buffer'),
};

module.exports = config;
