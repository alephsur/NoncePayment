# Phase 0 results — what works and what doesn't

> The deliverable of phase 0. The plan for phases 1–4 adapts to this, not the other way
> around. Updated at the close of each spike day. Last update: **September 10, 2026**.

| # | Question | Day | Status |
|---|---|---|---|
| 00 | Do the Solana polyfills work inside the app? | 1 | ✅ **YES** |
| 01 | Does a durable-nonce tx survive the passage of time? | 2 | ✅ **YES** — on localnet *and* devnet |
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

### The Android toolchain, and why `expo run:android` didn't find it

Worth recording, because none of it is guessable and it is four separate walls in a row.

| Piece | What was wrong | Fix |
|---|---|---|
| `ANDROID_HOME` | unset. Expo falls back to `~/Android/sdk`, and Android Studio installs to `~/Android/**S**dk` — capital S | exported in `~/.bashrc` |
| JDK | the only JDK was Android Studio's bundled JBR, **Java 25**. The project's Gradle is 8.10.2, which does not accept it | Temurin **17** in `~/.jdks`, `JAVA_HOME` points at it |
| SDK platform | only `android-37.0` installed; the project builds against **35** | `sdkmanager "platforms;android-35"` |
| build-tools | only `36.0.0`; the project pins **35.0.0** | `sdkmanager "build-tools;35.0.0"` |
| NDK | absent. React Native needs it to build native modules | `sdkmanager "ndk;26.1.10909125"` (~2.5 GB) |
| `cmdline-tools` | absent, so there was no `sdkmanager` to fix any of the above with | downloaded from Google |

Android Studio itself lives in `~/Downloads/android-studio-quail3-linux/` — worth moving
somewhere less disposable at some point.

With all of that, `./gradlew assembleDebug` finishes in about six minutes and produces
`android/app/build/outputs/apk/debug/app-debug.apk`. **The Android build chain works
end to end.** What is still missing is a phone plugged in: `adb devices` lists none.

### Still blocked from day 1

(Nothing from day 1 is blocked any more — see spike 00 below.)
- ~~**Devnet airdrop.**~~ Resolved — the account was funded by hand on 2026-09-10, and
  the devnet run of spike 01 is done (below).

---

## Spike 00 — polyfills inside the app · ✅ ANSWERED

**Risk #1 of the project, and it was real.** Run on an Android 15 emulator (`noncepay`
AVD, x86_64, KVM-accelerated). No physical device needed for this one: it only asks
whether the JS runtime can generate a keypair, not whether NFC or BLE work.

The app launches, and the home screen reads:

```
0 billetes · dispositivo 9yEY...Se5F
```

That short key is the output of `Keypair.generate()` running inside Hermes, so in one
line it proves `crypto.getRandomValues`, `Buffer` and `structuredClone` all work. Force-
stopping and relaunching shows the **same** key, which also proves the `expo-secure-store`
round-trip. **Phase 2 has ground to stand on.**

### Three real defects, in the order they surfaced

Getting there took four rebuilds, and every failure was a genuine bug that would have
cost a day later.

1. **`require('process')` in `index.js`.** Metro refuses it outright — the native React
   runtime has no Node standard library — so the bundle never built. Nothing needed real
   Node semantics, only `process.env` to exist, so it is now an empty object and no
   dependency.

2. **`expo-asset` was missing**, so Metro wouldn't even start. Installing the JS package
   is only half of it: the APK has to be **rebuilt**, or the app dies at runtime with
   `Cannot find native module 'ExpoAsset'`. Worth remembering — adding any Expo module
   from now on means a rebuild, not just an install.

3. **The polyfills ran too late, and this is the one that matters.** `index.js` set
   `global.Buffer` *after* its import statements. **ES module imports are hoisted**, so
   `./src/App` — and with it @solana/web3.js — loaded first and the app died with
   `Property 'Buffer' doesn't exist`. The file's own comment insisted the order mattered,
   and the order was wrong.

   The fix is structural: the polyfills now live in `app/polyfills.js`, and `index.js`
   imports it first. A module's side effects run when it is imported, so the assignments
   are done before the next import line is reached. Reordering statements inside one file
   could never have fixed this.

Metro also needed teaching about the SDK: `@noncepayment/sdk` is a `file:` dependency
symlinked outside the app, so `app/metro.config.js` now adds it to `watchFolders` and
pins one copy of `@solana/web3.js`, `@solana/spl-token` and `buffer` so `instanceof`
checks can't fail across duplicated instances.

### How to run it again

```bash
emulator -avd noncepay -no-window -no-audio -gpu swiftshader_indirect &
adb wait-for-device
cd app && npx expo run:android      # or: adb install -r <apk> && npx expo start --dev-client
adb exec-out screencap -p > shot.png
```

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

### The devnet run · ✅ confirmed

Same spike, real network, real waiting. The account was funded by hand
(the faucet rate-limits this IP), and then:

```bash
npx tsx 01-durable-nonce.ts create   # nonce 48F3ndNGC5QTBuQvGvugvT2cvEWvewtUdGDpAAH8stiE
#  ... 11.2 minutes later ...
npx tsx 01-durable-nonce.ts send     # ✅ confirmed
npx tsx 01-durable-nonce.ts double   # ❌ Blockhash not found
```

Transaction: [`5kP24xBB…oXKGyD`](https://solscan.io/tx/5kP24xBBwzUkC6zcYNkpy3q7yzSbL9LLJHZX1AEL64PtwDqi6A1NpNJsceinQtq6qSbrDJXYPFjgYf5yKxoXKGyD?cluster=devnet)
— signed at one moment, landed on chain **11.2 minutes later**. A normal transaction
would have expired after about a minute. The double spend against the same nonce was
rejected right after.

Real cost per banknote on devnet: **0.00105664 SOL** of nonce rent (localnet quotes
0.00144768 — devnet is the number that counts). Ten preloaded notes is ~0.0106 SOL,
recoverable when the slot closes.

### What this spike does NOT prove yet

- It hasn't run with the **Anchor program** in the loop, only with System Program SOL
  transfers. That's **day 8**, and it's still the test that matters most.


---

## Day 6 — a trap worth writing down: lamports and JavaScript

The `redeem` test that asserts the rent comes back to the owner failed by 48 lamports,
then by 16, then by a different number each run. It looked like the program was leaking
lamports. It wasn't.

The owner in the tests was Anchor's provider wallet, which collects airdrops until it
holds hundreds of millions of SOL. That balance in lamports is ~5·10¹⁷, well past
JavaScript's `Number.MAX_SAFE_INTEGER` (~9·10¹⁵), so `getBalance()` returns a number
whose last digits are rounding noise.

The fix is not a looser assertion — it's an owner with a realistic balance. `TestContext`
now uses a **fresh keypair funded with 10 SOL** as the owner, and the provider wallet
only pays for scaffolding (mints, ATAs, nonce accounts) so it never appears in a
measurement. Exact lamport assertions pass.

Any future test that measures SOL has to keep that separation.
