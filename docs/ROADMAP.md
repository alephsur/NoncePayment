# Roadmap — 29 days

> Start: **September 9, 2026** · Target submission: **October 6** ·
> Official deadline: **October 8**
> One developer. React Native / Expo. The two buffer days are non-negotiable.

---

## Principles that govern the whole plan

1. **Commit every day.** 25% of the score is literally the commit history. A repo with a
   single commit on October 7 disqualifies you in practice.
2. **Risky things first.** The technical unknowns get resolved on days 1–4, while there's
   still time to change the plan.
3. **The last 4 days are sacred.** Video and deck. Another 25% hangs on them.
4. **Every phase ends with something that works.** Never an "almost".

---

## Phase 0 · Days 1–4 · SPIKE

**The most important phase of the project.** Throwaway code, zero UI, zero pretty
architecture. Only answers to questions that could change the entire plan.

### Day 1 — Polyfills and toolchain
- [ ] `expo prebuild` + development build on a real Android device via EAS
- [ ] **Risk #1:** `Buffer`, `crypto.getRandomValues`, `structuredClone` working
      — generate a `Keypair` inside the app and see it on screen
- [x] Anchor + Solana CLI installed, `solana-test-validator` coming up
      — Anchor 0.31.1 / Solana 2.1.0 via `avm`. `anchor build` needed a dependency-resolution
      fix; see [`SPIKE-RESULTS.md`](SPIKE-RESULTS.md)

> If `Keypair.generate()` doesn't work inside the app by the end of day 1, **do not move
> on to anything else**. It's the foundation.

### Day 2 — Durable nonce end to end · ✅
- [x] `spikes/01-durable-nonce.ts`: create the nonce, sign a tx, wait past blockhash
      expiry, send it, and have it confirm
      — done on localnet, against a control tx that expires. Devnet still pending: the
      faucet rate-limits us
- [x] Confirm that a second tx signed against the same nonce **fails**
      (this IS the anti-double-spend guarantee; you have to watch it fail yourself)
      — `Blockhash not found`, watched with our own eyes

> Results: [`SPIKE-RESULTS.md`](SPIKE-RESULTS.md). The proof got stronger than planned:
> instead of trusting the clock, it signs a **control** tx with a normal blockhash at the
> same instant and shows it die while the durable one confirms.

### Day 3 — BLE between two phones
- [ ] Move 800 bytes from one Android device to another
- [ ] **Key decision:** who advertises? `react-native-ble-plx` only acts as central.
      The roles probably have to be inverted (the recipient advertises, the payer writes).
      Decide TODAY, not in week 3.

### Day 4 — NFC HCE, and the kill rule
- [ ] Config plugin → `HostApduService` in the manifest
- [ ] One phone emulates a card, the other reads 32 bytes

> ### 🚨 HARD RULE
> **If by the end of day 4 NFC isn't moving 32 bytes between two real phones, it gets
> buried.** Delete `transport/nfc.ts`, drop it from the selector, and continue with
> BLE + QR. No "just one more day". The transport architecture is already built to lose
> a layer without anything falling over.

**Phase output:** a one-page document stating what works and what doesn't. The plan for
phases 1–4 adapts to that reality, not the other way around.

---

## Phase 1 · Days 5–9 · Anchor program

- [x] Day 5 — `anchor keys sync`, deploy to localnet, `open_slot` with a test
      — program id `CwwpVy2fL2NoVYS1wZgvhfpumoCCQdmZd8194uKRpDo7`, deployed to localnet,
      **5 tests passing** in `program/tests/open-slot.ts`
- [ ] Day 6 — `redeem` with a happy-path test
- [ ] Day 7 — `reclaim` + edge-case tests (zero amount, excessive amount,
      unauthorized signer, wrong mint, wrong owner)
- [ ] Day 8 — **Integration test with the nonce**: sign `redeem` offline, wait,
      send. And the test that matters most: **the double spend has to fail**
- [ ] Day 9 — Deploy to devnet, public address in the README

**Phase output:** program on devnet, green suite, double spend proven impossible.

---

## Phase 2 · Days 10–16 · End-to-end app

Ugly but working. No polish here.

- [ ] Day 10 — MWA connect/reauthorize, real balance on screen
- [ ] Day 11 — Device key: generate, store, biometric gate
- [ ] Day 12 — **Load banknotes**: create nonces + `open_slot` via MWA, cache them
- [ ] Day 13 — **Pay**: `buildVoucher()` offline + transmission over QR
- [ ] Day 14 — **Receive**: `verifyVoucher()` offline + verification levels
- [ ] Day 15 — Settlement queue + background task
- [ ] Day 16 — The transport that won the spike (BLE, and NFC if it survived)

**Phase output:** the full loop works in airplane mode. **Record a rough video that same
day** — it's your safety net if something breaks later.

---

## Phase 3 · Days 17–21 · Where the 25% of Mobile UX is won

- [ ] Day 17 — Visual design: the banknotes have to *look* like banknotes
- [ ] Day 18 — **`.skr` domains** ← the $10,000 SKR bonus
- [ ] Day 19 — Seeker detection, a nod to Seed Vault, tap animation, haptics
- [ ] Day 20 — Error states: no banknotes, insufficient amount, biometrics cancelled,
      transport down, invalid voucher
- [ ] Day 21 — History + Solscan links + first-run onboarding

---

## Phase 4 · Days 22–25 · Real-world testing

- [ ] Day 22 — Two phones, airplane mode, out on the street. Write down everything that breaks
- [ ] Day 23 — Fix what came up
- [ ] Day 24 — Edge cases: low battery, app killed, flaky network, expired MWA session,
      reinstall with live banknotes
- [ ] Day 25 — **Feature freeze.** From here on, critical bugs only

---

## Phase 5 · Days 26–29 · Deliverables

- [ ] Day 26 — **Demo video.** The airplane-mode shot is the entire argument.
      60–120s. Script in `docs/DEMO-SCRIPT.md`
- [ ] Day 27 — **Pitch deck.** 10–12 slides. The threat-model slide is the one that sets
      you apart: it shows you understand your own system
- [ ] Day 28 — README, repo cleanup, signed release APK tested from scratch on a clean phone
- [ ] Day 29 (**October 6**) — **SUBMIT**

---

## Mapping phases to judging criteria

| Criterion | 25% | Where it's won |
|---|---|---|
| Completion | ✅ | Phases 2 and 5. It working + the video |
| Technical depth | ✅ | Phase 1 + daily commits all month |
| Mobile UX | ✅ | Phase 3 + whichever transport survives the spike |
| Solana integration | ✅ | Phase 1. Custom program, nonces, SPL |
| SKR bonus | 🎁 | Day 18 |

---

## Open questions to settle during the spike

1. **Who advertises over BLE?** Probably the recipient. Confirm on day 3.
2. **Does NFC survive?** Decided on day 4, under the hard rule.
3. **Devnet or mainnet for the video?** Devnet is safer. Mainnet with tiny amounts is more
   impressive. Decide on day 25, not before.
4. **Fixed denominations or free-form amounts when loading?** The program supports both
   (`redeem` accepts a partial amount with change). Fixed ones sell better.

---

## What's NOT in scope — decided and closed

❌ Partial amounts with complex change · ❌ Multi-token · ❌ Merchant/POS mode
❌ iOS · ❌ Our own backend · ❌ Walletless onboarding · ❌ Social recovery
