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

### Day 3 — BLE between two phones · ⏸ optional
> **Demoted on September 14.** Spike 03 showed NFC carries a whole signed voucher, so a
> tap payment no longer needs BLE. This spike only runs if the buffer days allow it —
> and advertising from `react-native-ble-plx` would need another native module first.

- [ ] Move 800 bytes from one Android device to another
- [ ] **Key decision:** who advertises? `react-native-ble-plx` only acts as central.
      The roles probably have to be inverted (the recipient advertises, the payer writes).

### Day 4 — NFC HCE, and the kill rule · ✅
- [x] Config plugin → `HostApduService` in the manifest
      — it registered the wrong AID for the library, and the library itself had three
      bugs that broke every tap after the first; all fixed before the phones came out
- [x] One phone emulates a card, the other reads 32 bytes
      — **OnePlus Nord 2 ↔ Seeker, in both directions**, same fingerprint on both screens
      — and then **a whole signed voucher (1055 B)**: 11/11 reads across both directions,
      each verified with `verifyVoucher()`, with a short tap. NFC can carry the payment,
      not just the handshake (see [`SPIKE-RESULTS.md`](SPIKE-RESULTS.md))

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
- [x] Day 12 — **Load banknotes**: create nonces + `open_slot` via MWA, cache them
      — one wallet approval for up to 8 banknotes, packed **2 per transaction** (measured:
      987 B for two, 1277 B for three, past the 1232 B limit), with the device-key SOL
      top-up riding in the first
      — the ledger is a **cache of the chain**, not the record: a load sends, confirms,
      then re-reads every slot of the owner from chain, and the same sync runs on launch.
      A load confirmed while the app was killed turns up on the next open
      — the sync never flips a banknote the phone already spent back to available, and
      tells banknotes apart by nonce account, since a closed slot's index gets reused
      — proven on devnet without the phone by `program/scripts/devnet-load.ts`, which runs
      the app's exact SDK path with a keypair in place of MWA and then cashes a voucher
      signed against the nonce value the sync read back. **All checks green**
      — **done on a real Seeker**: two loads through Seed Vault's approval sheet, $1 and
      $1+$5, confirmed on devnet and read back by the sync
      — and the phone found the bug the scripts could not: `Buffer.prototype.equals` does
      not survive a `subarray()` on Hermes, so reading the banknotes back threw and the
      home showed **$0 with the money already on chain**. See [`SPIKE-RESULTS.md`](SPIKE-RESULTS.md),
      "the one the tests could not catch"
      — the home now re-syncs on launch, on coming back to the foreground and on pull, and
      says out loud how much is locked under a previous device key
- [x] Day 13 — **Pay**: `buildVoucher()` offline + transmission over **NFC in two taps**
      (the recipient emulates its address, the payer reads it, signs, and emulates the
      voucher back), with **QR as the fallback** for phones without NFC
      — **the second tap already works between two real phones**: $1 paid Seeker → Nord 2,
      verified offline by the recipient and [settled on
      devnet](https://solscan.io/tx/3rF24B3npw3bb6w3zC7UBfA4vnXwGifvwoxJBfNAsjV5BYF42tV3iwxZRgzWmoSX38ecy67xB67SZN9BDNpxwBYW?cluster=devnet).
      The recipient's address is still typed in; that is what the first tap replaces
      — the transport still declared the pre-spike 255 B handshake budget, so it refused
      a 1025 B voucher before switching the antenna on. Spike 03's answer had never
      reached the code
      — **both taps now work on two real phones**: the recipient emulates a 76 B address
      tag, the payer reads it, confirms **who** it is paying, signs behind the fingerprint
      and emulates the voucher back. No keyboard anywhere in the gesture
      — the address tag is unsigned on purpose: it is a destination, not an authorisation,
      and what protects it is the payer seeing it before the fingerprint. Typing an
      address by hand stays, for a phone with no NFC
      — and the anti-double-spend guarantee was watched working outside a test: three
      vouchers signed against banknotes already redeemed came back `Blockhash not found`,
      dead forever. Settlement now says so instead of retrying ten times
- [ ] Day 14 — **Receive**: `verifyVoucher()` offline + verification levels
      — **the way out, which no plan had**: money received is not a banknote, it is plain
      USDC in the device key's token account, and the private key never leaves the
      Keystore — so without an in-app withdrawal that money can never move again.
      **Working on hardware**: $2 moved from the Nord 2's device key to the wallet, two
      signatures in one transaction (the device key as token authority, the wallet as fee
      payer, so a charge-only phone never needs SOL of its own)
      — the wallet only SIGNS; we broadcast. `signAndSendTransactions` is optional in MWA,
      and a wallet that sends uses its own RPC and its own cluster
      — **Phantom declines us**: `dApp identity is not verified`. It wants Digital Asset
      Links at `identity.uri` tying the domain to the package, and `noncepayment.app` is
      a placeholder we do not own. Seed Vault and Jupiter do not ask. Day 28, with the
      signed release — and both certificate fingerprints, debug and release
- [ ] Day 15 — Settlement queue + background task
      — **a real defect found on day 13, already fixed**: the queue verified every voucher
      against this phone's key, including the ones it had SENT, which are addressed to
      somebody else by definition. So the payer could never settle its own payments —
      ten attempts, ten "not addressed to me", then silence. Money only moved if the
      RECIPIENT came online, when the promise is that either side is enough. Five
      banknotes were sitting spent on the phone and still open on chain
      — giving up after ten attempts now has a way back: the home says how many gave up
      and offers a retry, because a long outage should not turn into money with no exit
      — `Blockhash not found` is told apart from a network failure. For the payer it
      means that banknote was already cashed; for the recipient it means **the payer
      double-spent them**, and it says so in those words
- [ ] Day 16 — **Freed up** (NFC already works end to end). Buffer first; then polish the
      tap gesture — timing, haptics, what each screen says between the two taps — because
      that gesture is the shot the video is built around

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

1. ~~**Who advertises over BLE?**~~ ⏸ Moot for now — BLE is off the critical path (spike 03).
2. ~~**Does NFC survive?**~~ ✅ **Yes** — 32 bytes both ways between a Nord 2 and a Seeker.
   ~~Can it carry the whole voucher?~~ ✅ **Yes** — 1055 B, 11/11, both directions. BLE is
   no longer on the critical path of a tap payment.
3. **Devnet or mainnet for the video?** Devnet is safer. Mainnet with tiny amounts is more
   impressive. Decide on day 25, not before.
4. **Fixed denominations or free-form amounts when loading?** The program supports both
   (`redeem` accepts a partial amount with change). Fixed ones sell better.

---

## What's NOT in scope — decided and closed

❌ Partial amounts with complex change · ❌ Multi-token · ❌ Merchant/POS mode
❌ iOS · ❌ Our own backend · ❌ Walletless onboarding · ❌ Social recovery
