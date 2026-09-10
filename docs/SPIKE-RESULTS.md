# Phase 0 results — what works and what doesn't

> The deliverable of phase 0. The plan for phases 1–4 adapts to this, not the other way
> around. Updated at the close of each spike day. Last update: **September 10, 2026**.

| # | Question | Day | Status |
|---|---|---|---|
| 00 | Do the Solana polyfills work inside the app? | 1 | 🚧 blocked on a device |
| 01 | Does a durable-nonce tx survive the passage of time? | 2 | ✅ **YES** |
| 02 | Can 800 bytes move over BLE between two phones? | 3 | ⬜ |
| 03 | Can 32 bytes move over NFC HCE? | 4 | ⬜ |

---

## Toolchain (day 1)

| Tool | Version | Notes |
|---|---|---|
| Solana CLI (Agave) | 3.1.10 | Installed by `avm` when resolving what Anchor asks for. 4.2.2 went in first and was superseded |
| Anchor | 0.31.1 | Via `avm`, pinned by `program/Anchor.toml`. 1.2.0 is also installed |
| `solana-test-validator` | ✅ starts | Used for spike 01, and it'll do for the day-5 tests |
| Node | 24.14.0 | |
| SDK (`packages/sdk`) | ✅ 9/9 tests | No network, no chain, as it should be |

**Required PATH** (the installer already appended it to `~/.profile`):

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
```

### `anchor build` needs a dependency-resolution fix

Worth writing down, because it costs an afternoon if you meet it cold. Anchor 0.31.1
pulls Solana 2.1.0, whose SBF toolchain is **Rust 1.79** — while the host cargo is 1.96.
A modern cargo happily resolves transitive crates that use `edition2024`, and then the
SBF cargo can't even parse their manifests:

```
error: failed to parse manifest at `.../indexmap-2.14.2/Cargo.toml`
  feature `edition2024` is required
```

Pinning crates one by one is whack-a-mole — a new one surfaces on every build. The fix
is two pieces, both committed:

- `programs/nonce-payment/Cargo.toml` declares `rust-version = "1.79.0"`.
- `program/.cargo/config.toml` sets `[resolver] incompatible-rust-versions = "fallback"`,
  so cargo picks the newest version of each crate that 1.79 can still build.

One crate escapes the fallback and still has to be pinned by hand in `Cargo.lock`:
`blake3` 1.8.7 requires `cpufeatures ^0.3`, and `cpufeatures` 0.3.1 is edition2024.
`cargo update -p blake3 --precise 1.5.5` settles it. **Commit `Cargo.lock`** — it's what
keeps the build reproducible.

### Still blocked from day 1

- **Spike 00 (polyfills inside the app).** Needs a real Android device and an EAS
  development build; it can't be closed from the dev environment. **This is risk #1 of
  the project**: until `Keypair.generate()` prints a key inside the app, phase 2 is
  standing on nothing.
- **Devnet airdrop.** The faucet rate-limits this IP for
  `6uJvsVeMhWLgqBxwRVW9pRhZAdFajMacPx2rWXC7pJZK`. It has to be funded by hand from
  <https://faucet.solana.com> (needs a GitHub account) before spike 01 can be repeated
  against devnet and, later, before the day-9 deploy.

---

## Spike 01 — durable nonce · ✅ ANSWERED

**The question of the project.** Run against `solana-test-validator` on 2026-09-10.

Localnet isn't a shortcut here: it produces slots fast, so a normal blockhash expires in
~66 seconds instead of ~90. Same proof, it just fits in two minutes instead of ten. It's
also a stronger proof than the roadmap asked for, because it compares against a control
instead of trusting the clock.

```bash
solana-test-validator --reset --quiet &
cd spikes && RPC=http://127.0.0.1:8899 npx tsx 01-durable-nonce.ts all
```

Two transactions are signed **at the same instant** — one with a normal blockhash (the
control), one with a durable nonce. The spike then waits until the control blockhash has
genuinely expired (polling `isBlockhashValid`, not a guessed `sleep`) and sends both:

| Step | Observed |
|---|---|
| 1. **Control** tx, normal blockhash, 66s later | ❌ `Transaction simulation failed: Blockhash not found` |
| 2. **Durable** tx, signed at the same instant | ✅ confirmed at 66s |
| 3. **Double spend**: a second tx (different recipient, different amount) against the same nonce value | ❌ `Transaction simulation failed: Blockhash not found` |

The nonce value changes as it is spent:

```
FJf51PR4qN7htvsB8FgvDZ7iUjMvBeux7DMkDnKKwUUy
  →  3z8N2kiguAJ6pU9je1Weweahn6Z5iuWHkYMxR6ezN5DJ
```

### Conclusions that change (or confirm) the plan

1. **A durable-nonce tx does not expire.** The product is viable. Phase 2 stands.
2. **We don't implement the anti-double-spend.** The runtime does: advancing the nonce
   invalidates every other signature made against the previous value. It's free and
   unconditional. This is the threat-model slide and the argument of the video.
3. **Step 3 was proven properly.** Resending the *same* transaction would have proven
   nothing — it could fail on deduplication alone. You have to sign a **different**
   transaction against the same nonce. The spike was corrected to do exactly that.
4. **Cost per banknote: 0.00144768 SOL of rent** for the nonce account, recoverable when
   the slot closes. Ten preloaded notes is ~0.0145 SOL. Affordable, but it has to be
   shown in the UI at load time (phase 3, day 20: error states).

### What this spike does NOT prove yet

- It hasn't run against **devnet** with a real >10 minute wait (blocked on the faucet).
  The spike's `create` / `send` mode exists for precisely that and should be run as soon
  as there's SOL. The mechanism is identical; only the timescale changes.
- It hasn't run with the **Anchor program** in the loop, only with System Program SOL
  transfers. That's **day 8**, and it's still the test that matters most.
