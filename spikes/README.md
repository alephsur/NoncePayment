# Spikes — days 1 to 4

Throwaway code. Don't refactor it, don't make it pretty, don't integrate it.
Its only job is to answer questions that could change the entire plan.

| # | Question | Day | Kill rule |
|---|---|---|---|
| 00 | Do the Solana polyfills work inside the app? | 1 | Blocking. Without this there is no project |
| 01 | Does a durable-nonce tx survive >10 min? | 2 | Blocking. It's the core of the product |
| 02 | Can 800 bytes move over BLE between two phones? | 3 | If not, QR remains |
| 03 | Can 32 bytes move over NFC HCE? | 4 | **If not: NFC gets buried and we move on** |

## 00 — Polyfills (inside the app, not here)

In the development build, on the first screen:

```tsx
import { Keypair } from '@solana/web3.js';
const kp = Keypair.generate();
console.log(kp.publicKey.toBase58());
```

If that prints a key, the foundation is in place. If it blows up, check the import order
in `app/index.js` — `react-native-get-random-values` goes first, before everything else.

## 01 — Durable nonce

```bash
npm install
solana-keygen new -o ~/.config/solana/id.json   # if you don't have one already
solana airdrop 2 --url devnet
npm run nonce
```

What has to happen:
1. The nonce account is created
2. A transaction is signed and saved to disk
3. **You wait more than 10 minutes** (or leave it and come back tomorrow)
4. You send it and it confirms
5. A second transaction against the same nonce **fails**

Step 5 is the one that matters. It's the anti-double-spend guarantee of the whole
product: you have to watch it fail with your own eyes before building anything on top.
