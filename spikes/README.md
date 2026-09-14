# Spikes — days 1 to 4

Throwaway code. Don't refactor it, don't make it pretty, don't integrate it.
Its only job is to answer questions that could change the entire plan.

| # | Question | Day | Kill rule |
|---|---|---|---|
| 00 | Do the Solana polyfills work inside the app? | 1 | Blocking. Without this there is no project |
| 01 | Does a durable-nonce tx survive >10 min? | 2 | ✅ **YES** — answered |
| 02 | Can 800 bytes move over BLE between two phones? | 3 | If not, QR remains |
| 03 | Can 32 bytes move over NFC HCE? | 4 | ✅ **YES** — answered, in the app (`NfcSpikeScreen`) |

## 00 — Polyfills (inside the app, not here)

In the development build, on the first screen:

```tsx
import { Keypair } from '@solana/web3.js';
const kp = Keypair.generate();
console.log(kp.publicKey.toBase58());
```

If that prints a key, the foundation is in place. If it blows up, check the import order
in `app/index.js` — `react-native-get-random-values` goes first, before everything else.

## 01 — Durable nonce · ✅ ANSWERED (2026-09-10)

Full results in [`../docs/SPIKE-RESULTS.md`](../docs/SPIKE-RESULTS.md).

### Full automated proof (localnet, ~2 min)

Localnet produces slots fast, so a normal blockhash expires in ~66s instead of ~90.
Same proof, it just fits in two minutes instead of ten.

```bash
npm install
solana-test-validator --reset --quiet &
RPC=http://127.0.0.1:8899 npx tsx 01-durable-nonce.ts all
```

It signs **two transactions at the same instant** — one with a normal blockhash (the
control) and one with a durable nonce — waits until the control blockhash has genuinely
expired (polling `isBlockhashValid`, not a guessed `sleep`), and sends both:

1. The control → `Blockhash not found`. It expired.
2. The durable one, signed at the same moment → **confirms**.
3. A second tx (different recipient, different amount) against the same nonce value →
   `Blockhash not found`.

Step 3 is the one that matters: it's the anti-double-spend guarantee of the product, and
Solana's runtime provides it, not our code. Watch out for the trap: **resending the same
tx proves nothing** (it could fail on deduplication alone). You have to sign a *different*
transaction.

### The slow devnet proof

Still pending: the faucet returns a rate limit. The key has to be funded by hand from
<https://faucet.solana.com>.

```bash
solana airdrop 2 --url devnet
npx tsx 01-durable-nonce.ts create   # signs and saves
#  ... wait >10 minutes (or leave it and come back tomorrow) ...
npx tsx 01-durable-nonce.ts send     # has to confirm
npx tsx 01-durable-nonce.ts double   # has to fail
```
