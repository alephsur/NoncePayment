# Architecture

## 1. The problem in one sentence

Two phones with no connectivity. One must hand value to the other in a way that is
**unforgeable**, **redeemable later**, and carries a **bounded double-spend risk**.

## 2. The three pieces

### 2.1 Durable nonces — why the transaction never expires

A normal Solana transaction carries a `recentBlockhash` and dies in ~60 seconds
(150 slots). Useless if you want to sign today and settle tomorrow.

A **nonce account** is an 80-byte System Program account that stores a stable blockhash.
If your transaction uses that value as its `recentBlockhash` and its **first instruction**
is `AdvanceNonceAccount`, the transaction **never expires**.

The property that turns this into money:

> Advancing the nonce changes the stored blockhash, which **invalidates any other
> transaction signed against the previous value**.

One nonce = one use. The Solana runtime enforces it. We don't have to do anything.

### 2.2 Collateralized slots — why the banknote is worth what it says

Every banknote is a `Slot` PDA holding:

| Field | Purpose |
|---|---|
| `owner` | the user's real wallet. Receives change and rent back |
| `authorized_signer` | the device key allowed to spend it offline |
| `nonce_account` | the paired, single-use nonce |
| `amount` | collateral locked in the vault PDA |

The money is **locked** in a vault PDA controlled by the program. A voucher is not a
promise to pay: it is an order against funds that are already held.

### 2.3 Device key — why we don't depend on the wallet while offline

This is the most important architectural decision in the project.

**Naive approach:** sign the voucher offline with Mobile Wallet Adapter / Seed Vault.
**Problem:** MWA means switching apps, and there is no guarantee the whole flow works in
airplane mode. That's an enormous risk to put on the core component of the product.

**Our approach:** a *session key* pattern.

```
Real wallet (Seed Vault, via MWA)      Device key (SecureStore + biometrics)
──────────────────────────────         ────────────────────────────────────────────
ONLINE only                            Always works, no network needed
Custodies the entire balance           Can only spend already-funded slots
Authorizes the device key              Acts as nonce authority and fee payer
Signs `open_slot` and `reclaim`        Signs `redeem` offline
```

Three wins at once:

1. **It removes the biggest technical risk** — nothing on the offline path depends on MWA.
2. **It bounds the blast radius** — if your unlocked phone is stolen, the attacker can
   only spend the loaded banknotes, never the full balance.
3. **It's better UX** — paying is a fingerprint, not a jump to another app.

And MWA is still genuinely integrated (a hackathon requirement): it's what custodies the money.

## 3. Anatomy of a voucher

```
Signed transaction (~599 raw bytes / ~800 in base64 — measured in the tests)

  ix[0]  SystemProgram::AdvanceNonceAccount    <- must be first
  ix[1]  CreateAssociatedTokenAccountIdempotent <- the recipient may not have an ATA
  ix[2]  nonce_payment::redeem(amount)          <- the payment

  recentBlockhash = cached nonce value          <- never expires
  feePayer        = device key
  signatures      = [device key]
```

600 bytes fit comfortably in a QR code. That number — measured, not estimated — is what
validates the entire transport strategy.

## 4. What the recipient can verify with no network

`verifyVoucher()` checks all of the following without a single network call:

- ✅ an authentic ed25519 signature over the exact message
- ✅ the transaction is durable (`AdvanceNonceAccount` comes first)
- ✅ it calls our program, `redeem` instruction
- ✅ I am the recipient
- ✅ the slot PDA derives from the declared owner
- ✅ the metadata matches the signed transaction (if it lies, it's rejected)
- ❌ **that the slot exists and holds collateral** ← impossible without network

Hence the `VerificationLevel` enum:

| Level | What it means |
|---|---|
| `CRYPTO_ONLY` | Everything verifiable offline. The signature is real, the structure is correct |
| `CACHED_STATE` | Plus: the slot was funded as of the last snapshot |
| `ONCHAIN_CONFIRMED` | Confirmed on chain. Full certainty |

The recipient's UI shows the level explicitly. It's honest, and it's also good product.

## 5. Flows

### Load (ONLINE)
```
User picks denominations  →  MWA authorizes
  → for each banknote: create nonce account + open_slot
  → cache {slot, nonceValue} in the local ledger
  → prefund the device key with ~0.01 SOL (fees + ATA rent)
```

### Pay (OFFLINE)
```
Amount + recipient  →  select the smallest banknote that covers it
  → biometrics  →  buildVoucher() [no network]
  → transport: NFC handshake → BLE, or QR
  → mark the slot as spent + enqueue for settlement
```

### Receive (OFFLINE)
```
Listen  →  receive bytes  →  verifyVoucher() [no network]
  → show amount + verification level
  → enqueue; if there's network, settle right away
```

### Settle (ONLINE, automatic)
```
Background task  →  network available?  →  send pending transactions
  → the nonce guarantees only one succeeds per slot
```

## 6. Design decisions and their alternatives

| Decision | Rejected alternative | Why |
|---|---|---|
| Vault per slot | Shared vault + accounting | The shared one saves ~0.002 SOL/banknote, but the isolated one is trivial to reason about and audit. With 29 days, simplicity wins |
| Device key | Signing with MWA offline | Removes the biggest technical risk in the project |
| Fee payer = device key | Fee payer = recipient | Having the recipient pay avoids prefunding SOL, but forces them to be the sender. With our approach either party can settle. Noted as a v2 optimization |
| Fixed denominations | Free-form amounts | Simplifies the program, bounds the risk, and reinforces the cash metaphor |
| Legacy `Transaction` | `VersionedTransaction` | Simpler serialization and parsing; we don't need ALTs |

## 7. Real rent cost per banknote

| Account | Bytes | ~SOL |
|---|---|---|
| Nonce account | 80 | 0.00144 |
| Slot PDA | 156 | 0.00189 |
| Vault (token account) | 165 | 0.00204 |
| **Total per banknote** | | **~0.0054 SOL** |

20 banknotes ≈ **0.11 SOL**. It's recoverable via `redeem` or `reclaim`, but you have to
show it to the user before they load up — hence `estimateNoteRentLamports()`.

Obvious v2 optimization: a shared vault, which wipes out 38% of the cost.
