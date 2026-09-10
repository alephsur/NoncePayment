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
