# Spikes — días 1 a 4

Código desechable. No lo refactorices, no lo hagas bonito, no lo integres.
Su único trabajo es responder preguntas que pueden cambiar el plan entero.

| # | Pregunta | Día | Regla de corte |
|---|---|---|---|
| 00 | ¿Funcionan los polyfills de Solana dentro de la app? | 1 | Bloqueante. Sin esto no hay proyecto |
| 01 | ¿Una tx con durable nonce sobrevive >10 min? | 2 | Bloqueante. Es el núcleo del producto |
| 02 | ¿Se mueven 800 bytes por BLE entre dos móviles? | 3 | Si no, queda el QR |
| 03 | ¿Se mueven 32 bytes por NFC HCE? | 4 | **Si no: se entierra el NFC y se sigue** |

## 00 — Polyfills (dentro de la app, no aquí)

En la development build, en la primera pantalla:

```tsx
import { Keypair } from '@solana/web3.js';
const kp = Keypair.generate();
console.log(kp.publicKey.toBase58());
```

Si eso imprime una clave, el cimiento está puesto. Si peta, revisa el orden de los
imports en `app/index.js` — `react-native-get-random-values` va el primero de todo.

## 01 — Durable nonce

```bash
npm install
solana-keygen new -o ~/.config/solana/id.json   # si no tienes ya una
solana airdrop 2 --url devnet
npm run nonce
```

Lo que tiene que pasar:
1. Se crea el nonce account
2. Se firma una transacción y se guarda en disco
3. **Esperas más de 10 minutos** (o lo dejas y vuelves mañana)
4. La envías y confirma
5. Una segunda transacción contra el mismo nonce **falla**

El paso 5 es el que importa. Es la garantía anti-doble-gasto del producto entero:
tienes que verla fallar con tus propios ojos antes de construir nada encima.
