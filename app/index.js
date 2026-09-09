/**
 * PUNTO DE ENTRADA — LOS POLYFILLS VAN LOS PRIMEROS.
 *
 * Esto no es opcional ni cosmetico. Es el fallo numero 1 de los proyectos Solana en
 * React Native, y si te pilla en la semana 3 te come dos dias. Ver docs/ROADMAP.md,
 * riesgo #1.
 *
 * El orden importa: `react-native-get-random-values` tiene que ejecutarse ANTES de que
 * se cargue nada de @solana/web3.js, porque instala crypto.getRandomValues, del que
 * depende la generacion de keypairs.
 */
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

global.Buffer = global.Buffer || Buffer;

// @solana/web3.js espera structuredClone, que Hermes no trae.
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

// Algunas dependencias esperan un `process` estilo Node.
if (typeof global.process === 'undefined') {
  global.process = require('process');
}
global.process.env = global.process.env || {};

import { registerRootComponent } from 'expo';
import App from './src/App';

registerRootComponent(App);
