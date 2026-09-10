# Threat model

> This document is pitch-deck material, not just engineering. The slide that comes out of
> it is probably the one that sets you furthest apart from other submissions: it shows you
> understand your own system instead of pretending it has no edges.

## 1. What the protocol guarantees

| Guarantee | How |
|---|---|
| **Vouchers cannot be forged** | ed25519 signature verified offline against the exact message |
| **A banknote is spent at most once** | Single-use nonce, enforced by the Solana runtime |
| **Every voucher is fully collateralized** | Funds are locked in a vault PDA before anything is signed |
| **The device key cannot drain you** | It can only spend already-funded slots, never the full balance |
| **Vouchers cannot be redirected** | The recipient is inside the signed message |
| **Metadata cannot lie** | Verification cross-checks it against the transaction and rejects mismatches |

## 2. The residual risk

**Attack:** the payer signs two vouchers against the same slot and hands them to two
different recipients, both offline. Only one will settle. The other gets nothing.

**This cannot be eliminated.** It is not an implementation flaw: it is a mathematical
impossibility. Without a shared point of consensus, two isolated parties cannot know they
have been promised the same thing. Every offline payment system has this property,
including electronic-cash wallets built on secure hardware.

What you *can* do is **bound it, attribute it, and close it fast**:

| Mitigation | Effect |
|---|---|
| **Fixed denominations** | Maximum loss is one banknote, not your balance |
| **`.skr` identity** | The payer is an identifiable person, not an anonymous address |
| **On-chain reputation** | The settlement history is public and queryable |
| **Automatic settlement** | The window closes by itself at the first moment of connectivity |
| **Visible verification level** | The recipient knows exactly what has been checked |

## 3. The risk window

The risk exists only between signing and settling. The app minimizes it aggressively:

- Background settlement as soon as connectivity returns
- Immediate settlement on receipt if the recipient has network
- Either party can settle — it doesn't have to be the recipient
- History visually marks what's still pending

In practice: seconds or minutes in a city, hours in the realistic worst case.

## 4. Other vectors

| Vector | Status |
|---|---|
| Stolen unlocked phone | Bounded to the loaded banknotes. Biometrics on every payment |
| Replay of the same voucher | Impossible: the nonce has already advanced and the slot is closed |
| Recipient tampers with the voucher | Breaks the signature → rejected |
| MITM over BLE | The voucher is signed and addressed; intercepting it achieves nothing |
| Device key extracted | Only spends already-funded slots. v2 mitigation: rotation + `reclaim` |
| RPC censorship | Either party can submit, from any RPC |

## 5. How to tell it in the pitch

One slide. Three blocks:

1. **What we guarantee** — the table in §1
2. **What we don't** — offline double spend, and why it's impossible for *anyone*
3. **How we bound it** — the mitigations table in §2

Suggested closer:

> *"We haven't solved offline double spending. Nobody can. We've turned it into a bounded,
> attributable, short-lived risk — which is exactly what physical cash has been doing for
> five centuries."*
