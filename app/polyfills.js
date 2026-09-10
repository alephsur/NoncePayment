/**
 * POLYFILLS. These must be fully applied before any Solana code is loaded.
 *
 * This is failure number one for Solana projects on React Native, and it eats two days
 * if it catches you in week 3. See docs/ROADMAP.md, risk #1.
 *
 * They live in their own module for a reason that is easy to get wrong: ES module
 * imports are HOISTED. Putting `global.Buffer = ...` in index.js next to
 * `import App from './src/App'` does not work, no matter what order the lines are in —
 * every import in a module runs before any of its statements, so App and everything it
 * pulls in (@solana/web3.js, the SDK) would load first and blow up with
 * "Property 'Buffer' doesn't exist".
 *
 * A module's side effects, on the other hand, run when it is imported. So index.js
 * imports this file first and these assignments are done by the time the next import
 * line is reached.
 */
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// @solana/web3.js reaches for Buffer all over: keys, signatures, instruction data.
global.Buffer = global.Buffer || Buffer;

// @solana/web3.js expects structuredClone, which Hermes doesn't ship.
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

/*
 * Some dependencies expect a Node-style `process`.
 *
 * This used to be `require('process')`, which does not resolve on React Native — the
 * native runtime has no Node standard library, and Metro refuses to bundle it. Nothing
 * here needs real Node semantics, only `process.env` to exist and be readable, so an
 * empty object is enough and it costs no dependency.
 */
if (typeof global.process === 'undefined') {
  global.process = {};
}
global.process.env = global.process.env || {};
