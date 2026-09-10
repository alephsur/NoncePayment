# NoncePayment — Reference document

> Hackathon: **CLOCK IN** (Solana Mobile × RadiantsDAO)
> Submission deadline: **October 8, 2026** · Target submission: **October 6**
> Team: 1 person · Stack: React Native / Expo + Anchor

---

## 1. What NoncePayment is

**Offline digital cash on Solana.**

You load USDC "banknotes" onto your phone while you have internet — like withdrawing cash
from an ATM. Later you pay another phone **while neither device has coverage**: they come
close, they tap, the money changes hands. As soon as either side gets back online, the
transaction settles on Solana automatically.

**The pitch in one sentence:** *stablecoin payments that work in airplane mode.*

**The demo video:** two phones with airplane mode visibly on, tap, "$20 received", you turn
on wifi, the transaction shows up on Solscan. 90 seconds.

---

## 2. Hackathon rules (the non-negotiables)

### Judging rubric — 4 criteria, 25% each

| Criterion | What they look at | How we attack it |
|---|---|---|
| **Completion** | That it works + demo video quality | Scope cut aggressively; 4 days reserved for video/deck |
| **Technical depth** | **GitHub commit history** + complexity | Daily commits from day 1; durable nonces + a custom Anchor program |
| **Mobile UX** | Mobile design + use of native capabilities | NFC HCE, BLE, biometrics, background tasks, Seed Vault |
| **Solana integration** | *Meaningful* interaction with the network | Custom on-chain program, SPL transfers, nonce accounts |

### Mandatory submission requirements

- [ ] **A working Android APK** (mandatory, non-negotiable)
- [ ] **Solana Mobile Stack + Mobile Wallet Adapter** integration
- [ ] **A Git repository the judges can access** (they review the commit history)
- [ ] **A demo video** showing functionality
- [ ] **A pitch deck** or short presentation

### Constraints

- **One submission only** per person/team. Multiple submissions = automatic disqualification.
- Only teams **without VC/angel funding** are eligible for the USDC prizes.
- Winners must **publish to the Solana dApp Store within 30 days** of the announcement.
- Single category (no tracks). Separately: **$10,000 in SKR** for the best SKR integration.
- Explicit warning from the organizers:
  > *"Direct ports or PWA wrappers with little mobile optimisation will score poorly."*

### Prizes

| Place | Prize |
|---|---|
| 1st | $30,000 USDC |
| 2nd | $25,000 |
| 3rd | $20,000 |
| 4th | $15,000 |
| 5th | $10,000 |
| 6th–10th | $5,000 each |
| SKR bonus | $10,000 in SKR |

Extras: co-marketing, featured placement in the dApp Store, Seeker devices, and a call with
Anatoly Yakovenko.

---

## 3. Why this idea can win first place

### Competitive context

- The previous edition had **403 submissions from 66 countries**.
- The 10 previous winners: a travel aggregator, a memecoin card game, stablecoin commerce,
  retail payments, LP management, and **five games/social apps**.
  → **Consumer apps win**, not infrastructure.
- In the real dApp Store (1,561 apps), **#2 by usage is Moonwalk Fitness** — an app that
  pays you to walk. In other words: **device sensors**.

### The differentiator

The winning pattern is clear: **something physically impossible to do in a web app**.
That's where the 25% for "Mobile UX" and the 25% for "Technical depth" separate you from
the rest of the field.

NoncePayment isn't just "hard to port to web" — it's **impossible**:
- HCE (Host Card Emulation) doesn't exist in browsers, nor openly on iOS.
- BLE peripheral mode doesn't exist in browsers.
- Signing without network and settling later requires secure local storage.

And it's still **genuinely useful**: emerging markets, subways, festivals, planes, rural
areas, blackouts. It isn't a technical demo without a use case.

---

## 4. Technical design — the core

### The problem

Offline payment: the payer has no internet, and neither does the recipient. The payer has to
hand over something that is (a) unforgeable, (b) redeemable on-chain later, and
(c) carries a bounded double-spend risk.

### The key piece: durable nonces

A normal Solana transaction **expires in ~60 seconds** because it carries a recent blockhash.
With a **nonce account**, the transaction uses a blockhash stored on-chain that **never
expires**. You sign today, it executes whenever.

And the critical property: **advancing the nonce invalidates any other transaction signed
against that same nonce**. The Solana runtime itself resolves the double spend. There's
nobody to trust.

> Officially documented by Solana for exactly this use case:
> https://solana.com/docs/core/transactions/durable-nonces

### Architecture: collateralized slots

```
ONLINE — load banknotes
  → The Anchor program opens N "slots", each with:
      · a nonce account (single use, guaranteed by the runtime)
      · USDC locked in a PDA (vault)
  → It's literally "withdrawing $200 from the ATM in banknotes"

OFFLINE — pay
  → You sign a complete transaction:
      [AdvanceNonce] + [CreateIdempotentATA(recipient)] + [redeem(slot_i, amount)]
  → You send it over NFC/BLE to the other phone
  → The recipient VERIFIES THE SIGNATURE offline and sees the slot is collateralized
  → They store it. No internet at any point.

RECONNECTION — settle
  → Either party submits it to the network
  → The program pays the recipient, returns the change to the payer, closes the slot
```

Every banknote is **fully collateralized** (the PDA holds the money locked) and
**single-use** (the nonce). That's real digital money, not a promise.

### The remaining hole — and why it's your best slide

The payer can sign two banknotes against the same slot and give them to two different
people. Only one settles.

**Nobody can eliminate this without a network. It's mathematically impossible.** What you
*can* do, and how you should present it:

- The risk is **bounded** to one banknote's denomination, not the whole balance.
- It's **attributable**: the payer is identified by their `.skr` domain.
- It's **detectable**: on-chain settlement history → a reputation score visible before you
  accept the payment.
- The window closes by itself: automatic settlement as soon as there's network.

A pitch deck that says *"here's what we do NOT solve, and here's why the residual risk is
acceptable"* scores far higher than one that pretends the problem doesn't exist.

See `docs/THREAT-MODEL.md` for the full analysis.

---

## 5. Transports: three layers, not one

**Golden rule for a solo dev: don't bet everything on NFC.**

| Layer | Purpose | Library | Risk |
|---|---|---|---|
| **QR** | Guaranteed fallback. Always works. | `expo-camera` | None |
| **BLE** | The workhorse. Full payload. | `react-native-ble-plx` | Medium |
| **NFC HCE** | The "wow" moment of the video. Handshake only. | `react-native-hce` | **High** |

### The trick that de-risks NFC

**NFC doesn't carry the whole voucher.** It carries only a 32-byte session identifier; BLE
does the actual exchange. That reduces NFC to its easy part while the video still gets its tap.

### Expo + NFC reality

`react-native-hce` is maintained and works, but **Expo doesn't support HCE natively**
(it's still an open feature request). You need:

- A **custom config plugin** injecting the `HostApduService` and `apduservice.xml` into the
  AndroidManifest → already written in `app/plugins/withNfcHce.js`
- **EAS Build with a development client**

**Expo Go is useless for any of this. Accept that from day 1.**

---

## 6. SKR integration — the $10,000 bonus

An almost empty category and cheap to attack. Two integrations, ~2 days:

1. **`.skr` domains as the recipient** — you pay `david.skr`, not a base58 address. It fits
   the cash metaphor perfectly and genuinely improves UX.
2. **A fee discount for paying in SKR**, or SKR cashback for settling fast (aligns the
   economic incentive with closing the double-spend risk window).

It's the best effort-to-prize ratio in the whole hackathon.

---

## 7. Scope cuts — decided NOW, not in week 3

As a solo dev, this is **out of scope**:

- ❌ Partial amounts with complex change → fixed denominations ($1/$5/$20/$50)
- ❌ Multi-token → **USDC only**
- ❌ Merchant / POS mode
- ❌ iOS
- ❌ Our own backend
- ❌ Walletless onboarding
- ❌ Social recovery / multi-device

Fixed denominations brutally simplify the program **and** reinforce the cash metaphor. It's
a cut that improves the product too.

---

## 8. The three risks that could sink the project

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Solana polyfills on RN** (`Buffer`, `crypto.getRandomValues`, `structuredClone`) | Settle it on **day 1**, inside the spike. It's the classic one that eats two days if it catches you on day 20. |
| 2 | **NFC HCE doesn't work** | **Hard rule: if it doesn't work by day 4, it gets buried** and we continue with BLE + QR. No debate, no "just one more day". |
| 3 | **Running out of time for the video** | The last 4 days are **untouchable**. It's literally the "Completion" criterion. |

---

## 9. Submission checklist

- [ ] Signed APK tested on a real device (not just an emulator)
- [ ] Public repo with daily commit history from day 1
- [ ] README with architecture, build instructions, and a demo GIF
- [ ] Demo video (60–120s) — the airplane-mode shot is the argument
- [ ] Pitch deck (10–12 slides, including the threat-model slide)
- [ ] Program deployed on devnet with a verifiable public address
- [ ] `.skr` integration working (SKR bonus)
- [ ] Submitted on **October 6** (2 buffer days)

---

## 10. Links

**Hackathon**
- Official FAQ: https://solanamobile.radiant.nexus/faq
- Registration: https://solanamobile.com/hackathon
- Previous edition winners: https://blog.solanamobile.com/post/solana-mobile-hackathon-winners-announced

**Solana Mobile**
- Docs: https://docs.solanamobile.com/
- Mobile Wallet Adapter: https://docs.solanamobile.com/mobile-wallet-adapter/mobile-apps
- dApp Store publishing: https://docs.solanamobile.com/dapp-publishing/intro
- Detecting Seeker users: https://docs.solanamobile.com/recipes/detecting-seeker-users
- SKR: https://solanamobile.com/skr

**Durable nonces**
- Official docs: https://solana.com/docs/core/transactions/durable-nonces
- Guide: https://solana.com/developers/guides/advanced/introduction-to-durable-nonces
- Cookbook (offline tx): https://solana.com/developers/cookbook/transactions/offline-transactions

**Native libraries**
- react-native-hce: https://github.com/appidea/react-native-hce
- react-native-ble-plx: https://github.com/dotintent/react-native-ble-plx
- HCE on Expo (feature request): https://expo.canny.io/feature-requests/p/nfc-host-based-card-emulation
