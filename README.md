# NoncePayment

**Offline digital cash on Solana.** Pay in USDC from your phone in airplane mode.

> Submission for **CLOCK IN** — Solana Mobile × RadiantsDAO. Deadline: October 8, 2026.

---

## The pitch

You load USDC "banknotes" onto your phone while you have internet, the same way you
withdraw cash from an ATM. Later you pay another phone **while neither device has
coverage**: they come close, they tap, the money changes hands. As soon as either side
gets back online, the transaction settles on Solana automatically.

It works because a Solana **durable nonce** makes a signed transaction **never expire**,
and because advancing that nonce **invalidates any other transaction signed against it**
— so the Solana runtime itself guarantees that every banknote is spent at most once.

---

## On chain

| | |
|---|---|
| Program (devnet) | [`CwwpVy2fL2NoVYS1wZgvhfpumoCCQdmZd8194uKRpDo7`](https://solscan.io/account/CwwpVy2fL2NoVYS1wZgvhfpumoCCQdmZd8194uKRpDo7?cluster=devnet) |
| Instructions | `open_slot` · `redeem` · `reclaim` |

The whole loop, run against that deployed program with the real SDK
(`program/scripts/devnet-smoke.ts`):

1. [**Banknote loaded**](https://solscan.io/tx/62sfcL5YmB4uvmd69rCSdbbNZ28a9SSPy44hDq5pFTCZbTgthA66i3BAhTwdoSZkExzmPjSWrxQR5gfLTqLRah9D?cluster=devnet) — 5 locked in a vault, paired with a durable nonce
2. **Two vouchers signed with no network**, 800 bytes each, from the same banknote to two
   different people. Both verify offline; neither recipient can tell there is a problem
3. [**The first one gets paid**](https://solscan.io/tx/4qKEjcLx1x5oCLvXmPSkH53wfiNHBQDUKskHCxvd7anAo3ba57gYZfyC31WpcZ4yjZpDZVcUZGcui812ANSRiPQ?cluster=devnet)
4. **The second one is dead**: `Blockhash not found`

And, separately, the durability claim itself — a transaction
[signed and sent 11.2 minutes later](https://solscan.io/tx/5kP24xBBwzUkC6zcYNkpy3q7yzSbL9LLJHZX1AEL64PtwDqi6A1NpNJsceinQtq6qSbrDJXYPFjgYf5yKxoXKGyD?cluster=devnet),
where a normal one expires after about a minute.

---

## Status

| Component | Status |
|---|---|
| **Durable nonce spike** | ✅ **proven on devnet** — [11.2 min old tx, confirmed](https://solscan.io/tx/5kP24xBBwzUkC6zcYNkpy3q7yzSbL9LLJHZX1AEL64PtwDqi6A1NpNJsceinQtq6qSbrDJXYPFjgYf5yKxoXKGyD?cluster=devnet) |
| Toolchain (Solana CLI, Anchor, test validator) | ✅ installed and running |
| Anchor program (`open_slot` / `redeem` / `reclaim`) | ✅ **deployed to devnet**, full loop verified on chain |
| Program tests — `open_slot`, `redeem`, `reclaim`, durable nonce | ✅ **21/21 passing** |
| SDK: voucher construction and verification | ✅ **9/9 tests passing**, and pinned against the program on chain |
| RN polyfills + app entry point | ✅ **proven on device** — `Keypair.generate()` runs inside the app |
| NFC HCE config plugin | ✅ written, spike pending |
| QR transport | ✅ scaffolding ready |
| BLE transport | 🚧 blocked on the spike (day 3) |
| NFC transport | 🚧 blocked on the spike (day 4) — has a kill rule |
| Pay / Receive screens | ✅ scaffolding ready |
| Background settlement queue | ✅ written |
| `.skr` domains (SKR bonus) | ⬜ day 18 |

---

## Layout

```
NoncePayment/
├── docs/
│   ├── REFERENCE.md      ← hackathon rules, strategy, submission checklist
│   ├── ARCHITECTURE.md   ← technical design: nonces, slots, device key
│   ├── ROADMAP.md        ← day-by-day plan for the 29 days
│   └── THREAT-MODEL.md   ← material for the slide that sets you apart
├── program/              ← Anchor program
├── packages/sdk/         ← shared logic: vouchers, nonces, slots (+ tests)
├── app/                  ← Expo / React Native app
└── spikes/               ← throwaway code from days 1-4
```

**Start with `docs/ROADMAP.md`.**

---

## Quick start

```bash
# 1. SDK — the core. Tests run with no network and no chain.
cd packages/sdk && npm install && npx tsx test/voucher.test.ts

# 2. Durable nonce spike — the proof the whole product rests on (~2 min, no faucet)
cd ../../spikes && npm install
solana-test-validator --reset --quiet &
RPC=http://127.0.0.1:8899 npx tsx 01-durable-nonce.ts all

# 3. Program — builds, deploys to a throwaway validator and runs the suite
cd ../program && npm install && anchor test --provider.cluster localnet

# 3b. The same loop against the program already live on devnet (~0.024 SOL)
npx tsx scripts/devnet-smoke.ts

# 4. App (a development build is mandatory — Expo Go will NOT work)
#    npm install builds the SDK first, via its `prepare` script
cd ../app && npm install && npm run typecheck
npx expo prebuild -p android

#    Then one of the two. EAS needs an Expo account (`eas init` writes the
#    projectId into app.json); run:android needs the Android SDK and a plugged-in phone.
npm run build:dev          # eas build --profile development
npx expo run:android       # local build
```

---

## The three risks

1. ~~**Solana polyfills on RN**~~ — ✅ settled. Three real defects, all fixed; the app
   generates a keypair on screen.
2. **NFC HCE** — hard rule: if it doesn't work by day 4, it gets buried and we ship BLE + QR.
3. **Running out of time for the video** — the last 4 days are untouchable.

---

## License

MIT
