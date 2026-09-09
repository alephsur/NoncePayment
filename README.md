# NoncePayment

**Efectivo digital offline sobre Solana.** Paga en USDC con el móvil en modo avión.

> Entrega para **CLOCK IN** — Solana Mobile × RadiantsDAO. Cierre: 8 de octubre de 2026.

---

## El pitch

Cargas "billetes" de USDC en el móvil mientras tienes internet, como sacar dinero de un
cajero. Después pagas a otro móvil **sin cobertura ninguno de los dos**: se acercan, se
tocan, el dinero cambia de manos. Cuando cualquiera de los dos vuelve a tener red, la
transacción se liquida en Solana automáticamente.

Funciona porque un **durable nonce** de Solana hace que una transacción firmada **no
caduque nunca**, y porque avanzar ese nonce **invalida cualquier otra transacción
firmada contra él** — así que el propio runtime de Solana garantiza que cada billete se
gasta como máximo una vez.

---

## Estado

| Componente | Estado |
|---|---|
| Programa Anchor (`open_slot` / `redeem` / `reclaim`) | ✅ escrito, pendiente de desplegar |
| SDK: construcción y verificación de vouchers | ✅ **9/9 tests pasan** |
| Polyfills de RN + entrada de la app | ✅ escrito |
| Config plugin de NFC HCE | ✅ escrito, pendiente de spike |
| Transporte QR | ✅ estructura lista |
| Transporte BLE | 🚧 pendiente del spike (día 3) |
| Transporte NFC | 🚧 pendiente del spike (día 4) — con regla de corte |
| Pantallas Pagar / Cobrar | ✅ estructura lista |
| Cola de liquidación en background | ✅ escrito |
| Dominios `.skr` (bonus SKR) | ⬜ día 18 |

---

## Estructura

```
NoncePayment/
├── docs/
│   ├── REFERENCE.md      ← reglas del hackathon, estrategia, checklist de entrega
│   ├── ARCHITECTURE.md   ← diseño técnico: nonces, slots, clave de dispositivo
│   ├── ROADMAP.md        ← plan día a día de los 29 días
│   └── THREAT-MODEL.md   ← material para el slide que te separa del resto
├── program/              ← programa Anchor
├── packages/sdk/         ← lógica compartida: vouchers, nonces, slots (+ tests)
├── app/                  ← app Expo / React Native
└── spikes/               ← código desechable de los días 1-4
```

**Empieza por `docs/ROADMAP.md`.**

---

## Arranque rápido

```bash
# 1. SDK — el núcleo. Los tests corren sin red ni cadena.
cd packages/sdk && npm install && npx tsx test/voucher.test.ts

# 2. Spike del durable nonce (necesita SOL de devnet)
cd ../../spikes && npm install
solana airdrop 2 --url devnet
npx tsx 01-durable-nonce.ts create
#  ... espera >10 minutos ...
npx tsx 01-durable-nonce.ts send

# 3. Programa
cd ../program && anchor keys sync && anchor build && anchor test

# 4. App (development build obligatoria — Expo Go NO sirve)
cd ../app && npm install && npx expo prebuild -p android && npm run build:dev
```

---

## Los tres riesgos

1. **Polyfills de Solana en RN** — resolver el día 1. Come dos días si te pilla el día 20.
2. **NFC HCE** — regla dura: si el día 4 no funciona, se entierra y se sigue con BLE + QR.
3. **Quedarse sin tiempo para el vídeo** — los últimos 4 días son intocables.

---

## Licencia

MIT
