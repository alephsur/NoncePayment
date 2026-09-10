/**
 * ENTRY POINT — THE POLYFILLS COME FIRST, AND THIS IMPORT MUST STAY FIRST.
 *
 * Not decoration: ES module imports are hoisted and run in order, so `./polyfills` is
 * fully applied before `./src/App` — and therefore before @solana/web3.js — is loaded.
 * Move this line down and the app dies on startup with "Property 'Buffer' doesn't
 * exist". See polyfills.js for the full story.
 */
import './polyfills';

import { registerRootComponent } from 'expo';
import App from './src/App';

registerRootComponent(App);
