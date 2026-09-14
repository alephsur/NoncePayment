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

### Day 1 — Polyfills and toolchain · ✅
- [x] `expo prebuild` + a development build that installs and runs
      — built locally rather than via EAS; runs on an Android 15 emulator
- [x] **Risk #1:** `Buffer`, `crypto.getRandomValues`, `structuredClone` working
      — generate a `Keypair` inside the app and see it on screen
      — **done**, and it took three real fixes to get there; see [`SPIKE-RESULTS.md`](SPIKE-RESULTS.md)
- [x] Anchor + Solana CLI installed, `solana-test-validator` coming up
      — Anchor 0.31.1 / Solana 2.1.0 via `avm`. `anchor build` needed a dependency-resolution
      fix; see [`SPIKE-RESULTS.md`](SPIKE-RESULTS.md)

> If `Keypair.generate()` doesn't work inside the app by the end of day 1, **do not move
> on to anything else**. It's the foundation.

### Day 2 — Durable nonce end to end · ✅
- [x] `spikes/01-durable-nonce.ts`: create the nonce, sign a tx, wait past blockhash
      expiry, send it, and have it confirm
      — done on localnet against a control tx that expires, **and on devnet with a real
      11.2 minute wait**
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

### Day 4 — NFC HCE, and the kill rule · ✅
- [x] Config plugin → `HostApduService` in the manifest
      — it registered the wrong AID for the library, and the library itself had three
      bugs that broke every tap after the first; all fixed before the phones came out
- [x] One phone emulates a card, the other reads 32 bytes
      — **OnePlus Nord 2 ↔ Seeker, in both directions**, same fingerprint on both screens
      — still to run: the 10-tap series each way, the edge cases, and ~800 B
      (see [`SPIKE-RESULTS.md`](SPIKE-RESULTS.md))

> **Outcome: NFC survives.**
>
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
- [x] Day 6 — `redeem` with a happy-path test
      — full payment, partial payment with change, rent returned, and a recipient with
      no USDC account. **9 tests passing** across the suite
- [x] Day 7 — `reclaim` + edge-case tests (zero amount, excessive amount,
      unauthorized signer, wrong mint, wrong owner)
      — plus two the list didn't have: a vault borrowed from another banknote, and
      reclaiming one that was already spent
- [x] Day 8 — **Integration test with the nonce**: sign `redeem` offline, wait,
      send. And the test that matters most: **the double spend has to fail**
      — the voucher is built by the **real SDK**, confirms 63s after signing, and two
      vouchers from the same banknote leave the second one uncashable. **21 tests**
- [x] Day 9 — Deploy to devnet, public address in the README
      — `CwwpVy2fL2NoVYS1wZgvhfpumoCCQdmZd8194uKRpDo7`, and `scripts/devnet-smoke.ts`
      runs the whole loop against it on chain

**Phase output:** ✅ program on devnet, green suite (21 tests), double spend proven
impossible — on localnet and on devnet.

---

## Phase 2 · Days 10–16 · End-to-end app

Ugly but working. No polish here.

- [x] Day 10 — MWA connect/reauthorize, real balance on screen
      — verified on a **real Seeker**: Seed Vault's sheet approves, the card shows the
      USDC balance, and a force-stop + relaunch reconnects with no dialog
- [x] Day 11 — Device key: generate, store, biometric gate
      — the secret now lives in an **authenticated Keystore entry**: Android itself
      refuses to decrypt it without a Class 3 biometric, so the gate is the cipher and
      not an `if`. The public half sits in a second, unauthenticated entry so the UI
      renders with no prompt and no network
      — that split is what catches the trap: when the user enrols a new fingerprint
      Android destroys the key and `getItemAsync` returns **`null`**, exactly like a key
      that never existed. A one-slot design would silently generate a new keypair and
      orphan every loaded banknote. Now it says so, and offers `reclaim` as the way out
      — `expo-secure-store` added as a config plugin: without it the encrypted entries
      go into Android Auto Backup while the Keystore keys do not
      — **pending on the phone:** create the key, watch the prompt, pay with it, then
      enrol a new fingerprint and confirm the app reports the key as destroyed
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
      — head start: MWA already returns the domain as the account label. The test
      Seeker authorises as `alephsur.skr`, so the display half may be nearly free
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
2. ~~**Does NFC survive?**~~ ✅ **Yes** — 32 bytes both ways between a Nord 2 and a Seeker.
   Open follow-up: can it carry the whole ~800 B voucher?
3. **Devnet or mainnet for the video?** Devnet is safer. Mainnet with tiny amounts is more
   impressive. Decide on day 25, not before.
4. **Fixed denominations or free-form amounts when loading?** The program supports both
   (`redeem` accepts a partial amount with change). Fixed ones sell better.

---

## What's NOT in scope — decided and closed

❌ Partial amounts with complex change · ❌ Multi-token · ❌ Merchant/POS mode
❌ iOS · ❌ Our own backend · ❌ Walletless onboarding · ❌ Social recovery
