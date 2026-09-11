# Running the app

Step by step, on an emulator first and then on a phone. Everything in the emulator
section was run end to end on 2026-09-11 and works. The phone section is marked where
it has **not** been verified yet, because no device has been plugged in so far.

Do the emulator first even if the phone is what you care about: it separates "my code is
broken" from "my device is misconfigured", and it is the only way to bisect a failure
quickly.

---

## 0. Environment — once per machine

`~/.bashrc` already exports these. **Open a new terminal** after any change, or the
variables won't be there:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="$HOME/.jdks/jdk-17.0.20.1+1"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$PATH"
```

Check it:

```bash
java -version      # must say 17. NOT the Java 25 bundled with Android Studio
adb --version
emulator -version
```

> **Why a separate JDK.** Android Studio ships Java 25 and the project's Gradle is
> 8.10.2, which refuses it. `JAVA_HOME` must point at the Temurin 17 in `~/.jdks`.

Install the JS dependencies once (this also builds the SDK, through its `prepare`
script — the app cannot typecheck or bundle without that):

```bash
cd app && npm install
npm run typecheck        # should print nothing
```

---

## 1. Emulator

### 1a. The AVD

One called `noncepay` already exists. To list, or to recreate it elsewhere:

```bash
avdmanager list avd

# from scratch:
sdkmanager "system-images;android-35;google_apis;x86_64"
avdmanager create avd -n noncepay -k "system-images;android-35;google_apis;x86_64" -d pixel_7
```

### 1b. Start it

```bash
emulator -avd noncepay &
```

Headless, for a terminal-only box or CI:

```bash
emulator -avd noncepay -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
```

Wait until it is actually up — `adb devices` listing it is **not** enough, the system
may still be booting:

```bash
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done
adb devices        # emulator-5554   device
```

Cold boot takes about 30 seconds on this machine, with KVM. Without KVM it is minutes —
check with `[ -r /dev/kvm ] && [ -w /dev/kvm ] && echo ok`.

### 1c. Build, install, run

One command does all of it — build the APK, start Metro, install, launch:

```bash
cd app
npx expo run:android          # same as: npm run android
```

First run takes about six minutes because of the NDK; later ones are seconds.

### 1d. Check it worked

The home screen should read something like:

```
0 billetes · dispositivo G5U4...r7DX
```

**That short key is the whole point.** It is `Keypair.generate()` running inside Hermes,
so if it renders, `crypto.getRandomValues`, `Buffer` and `structuredClone` all work —
risk #1 of the project. See `SPIKE-RESULTS.md`, spike 00.

From the terminal:

```bash
adb logcat -d | grep ReactNativeJS        # want: Running "main"
adb exec-out screencap -p > shot.png      # screenshot without touching the UI
```

### 1e. Day to day

```bash
r                                    # in the Metro terminal: reload
adb shell am force-stop com.noncepayment.app   # kill it
adb shell am start -n com.noncepayment.app/.MainActivity
adb emu kill                         # shut the emulator down
```

Editing JS only? Metro hot-reloads, nothing to rebuild. **Adding or removing any native
module — anything under `expo-*`, or a library with an Android folder — means a real
rebuild**, not just an `npm install`; otherwise the app dies at runtime with
`Cannot find native module '...'`.

```bash
npx expo prebuild -p android --clean && npx expo run:android
```

---

## 2. Phone

> **Not verified yet.** No device has been connected. The steps are standard and the
> build itself is already proven on the emulator, but expect the unexpected the first
> time, and write down whatever breaks.

The emulator cannot do the three things this project is actually about — **NFC, BLE and
Mobile Wallet Adapter** — so everything from roadmap day 10 onwards needs real hardware.

### 2a. Prepare the phone

1. **Settings → About phone**, tap **Build number** seven times. It says you are now a
   developer.
2. **Settings → System → Developer options**:
   - **USB debugging** → on
   - **Install via USB** → on (some ROMs)
   - **Stay awake** → on, it saves a lot of irritation
3. Plug it in with a **data** cable. Charge-only cables are a classic waste of an hour.
4. Unlock the phone and accept **Allow USB debugging** when it appears.

```bash
adb devices
```

- `device` → good.
- `unauthorized` → the dialog was not accepted. Look at the screen; if it never showed,
  `adb kill-server && adb start-server` and replug.
- nothing listed → cable, port, or the phone is in charge-only USB mode (change it in
  the USB notification).

### 2b. Run

With the phone the only device attached, exactly the same command as the emulator:

```bash
cd app
npx expo run:android
```

With **both** an emulator and a phone connected, say which one — and note that
`--device` wants the *name* from Expo's own picker, not the adb id:

```bash
npx expo run:android          # it asks which device when there is more than one
```

> **The APK is built for one architecture.** With a phone attached, `expo run:android`
> builds **only that phone's ABI** — so the resulting APK will **not** run on the
> x86_64 emulator, and it fails in a way that does not name the cause:
>
> ```
> couldn't find DSO to load: libexpo-modules-core.so
> TypeError: Cannot read property 'EventEmitter' of undefined
> "main" has not been registered
> ```
>
> To get one APK that runs on both, build every ABI yourself:
>
> ```bash
> cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64
> adb -s <device> install -r app/build/outputs/apk/debug/app-debug.apk
> ```

The app connects to Metro over `adb reverse`, which `expo run:android` sets up. If the
bundle does not load, do it by hand:

```bash
adb reverse tcp:8081 tcp:8081
```

### 2c. Wireless (Android 11+)

Useful once you are testing NFC or BLE and a cable is in the way:

```bash
# once, over USB:
adb tcpip 5555
# unplug, then, with the phone on the same wi-fi:
adb connect <phone-ip>:5555
```

The IP is in **Settings → About phone → Status**. On wi-fi, Metro is not reachable
through `adb reverse` on every network — if the bundle will not load, run
`npx expo start --dev-client --lan` and let the phone reach your machine directly.

### 2d. A wallet, for MWA

Mobile Wallet Adapter talks to a wallet app installed on the same phone. Install one
before day 10 — **Phantom**, **Solflare**, or Seed Vault on a Seeker — and **switch it to
devnet**, which is what `app.json` (`extra.cluster`) is set to. Without a wallet, connect
does nothing and it looks like our bug.

### 2e. Release APK, for the day-28 clean-phone test

The debug APK needs Metro running; a release one is self-contained but has to be signed.
That's a day-28 task; `eas build --profile preview` is the path of least resistance, and
it needs an Expo account plus `eas init`.

---

## 3. When it breaks

| Symptom | Cause | Fix |
|---|---|---|
| `Failed to resolve the Android SDK path` | `ANDROID_HOME` unset, or a new terminal without `~/.bashrc` | see §0 |
| Gradle rejects the Java version | `JAVA_HOME` is Android Studio's Java 25 | point it at Temurin 17 |
| `Unable to resolve module process` | Node stdlib in `index.js` | already fixed — see `polyfills.js` |
| `Unable to resolve "@noncepayment/sdk"` | the SDK is a `file:` symlink outside the app | `metro.config.js` handles it; if it returns, `cd packages/sdk && npm run build` |
| `Cannot find native module 'X'` | a native module was installed but the APK is stale | `npx expo prebuild -p android --clean && npx expo run:android` |
| `Property 'Buffer' doesn't exist` | the polyfills ran too late | `import './polyfills'` must be the **first** line of `index.js` |
| `adb: no devices/emulators found` | emulator still booting, or USB debugging off | §1b / §2a |
| App opens white and then dies | Metro not reachable | `adb reverse tcp:8081 tcp:8081` |
| `libexpo-modules-core.so` not found, or `EventEmitter of undefined` | APK built for another CPU (phone ABI on the emulator, or vice versa) | rebuild with `-PreactNativeArchitectures=arm64-v8a,x86_64` |
| App won't start on the phone, no error anywhere | screen locked — the activity can't come to the front | unlock the phone first |
| Metro serves stale code | cache | `npx expo start --dev-client --clear` |
