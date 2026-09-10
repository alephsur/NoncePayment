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

## Status

| Component | Status |
|---|---|
| **Durable nonce spike** | ✅ **proven** — see [`docs/SPIKE-RESULTS.md`](docs/SPIKE-RESULTS.md) |
| Toolchain (Solana CLI, Anchor, test validator) | ✅ installed and running |
| Anchor program (`open_slot` / `redeem` / `reclaim`) | ✅ builds; deployed to localnet, not yet to devnet |
| Program tests — `open_slot` | ✅ **5/5 passing** |
| SDK: voucher construction and verification | ✅ **9/9 tests passing** |
| RN polyfills + app entry point | 🚧 written, spike pending on a real device |
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

# 4. App (a development build is mandatory — Expo Go will NOT work)
cd ../app && npm install && npx expo prebuild -p android && npm run build:dev
```

---

## The three risks

1. **Solana polyfills on RN** — settle it on day 1. It eats two days if it catches you on day 20.
   Still open: it needs a real device.
2. **NFC HCE** — hard rule: if it doesn't work by day 4, it gets buried and we ship BLE + QR.
3. **Running out of time for the video** — the last 4 days are untouchable.

---

## License

MIT
