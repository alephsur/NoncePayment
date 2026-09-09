# Roadmap — 29 días

> Inicio: **9 de septiembre de 2026** · Entrega objetivo: **6 de octubre** ·
> Cierre oficial: **8 de octubre**
> Un desarrollador. React Native / Expo. Los dos días de colchón no son negociables.

---

## Principios que gobiernan todo el plan

1. **Commitea todos los días.** Un 25% de la nota es literalmente el historial de
   commits. Un repo con un único commit el día 7 de octubre te descalifica de facto.
2. **Lo arriesgado primero.** Las incógnitas técnicas se resuelven en los días 1–4,
   cuando todavía hay tiempo de cambiar de plan.
3. **Los últimos 4 días son sagrados.** Vídeo y deck. Otro 25% cuelga de ahí.
4. **Cada fase termina con algo que funciona.** Nunca un "casi".

---

## Fase 0 · Días 1–4 · SPIKE

**La fase más importante del proyecto.** Código desechable, cero UI, cero
arquitectura bonita. Solo respuestas a preguntas que pueden cambiar el plan entero.

### Día 1 — Polyfills y toolchain
- [ ] `expo prebuild` + development build en un Android real vía EAS
- [ ] **Riesgo #1:** `Buffer`, `crypto.getRandomValues`, `structuredClone` funcionando
      — generar un `Keypair` dentro de la app y verlo en pantalla
- [ ] Anchor + Solana CLI instalados, `solana-test-validator` levantando

> Si `Keypair.generate()` no funciona dentro de la app al terminar el día 1, **no
> sigas con nada más**. Es el cimiento.

### Día 2 — Durable nonce de punta a punta
- [ ] `spikes/01-durable-nonce.ts` en devnet: crear nonce, firmar una tx, esperar
      **más de 10 minutos**, enviarla y que confirme
- [ ] Confirmar que una segunda tx firmada contra el mismo nonce **falla**
      (esto ES la garantía anti-doble-gasto; hay que verla fallar con tus ojos)

### Día 3 — BLE entre dos móviles
- [ ] Mover 800 bytes de un Android a otro
- [ ] **Decisión clave:** ¿quién anuncia? `react-native-ble-plx` solo hace de central.
      Probablemente haya que invertir papeles (el receptor anuncia, el pagador escribe).
      Decidir HOY, no en la semana 3.

### Día 4 — NFC HCE, y la regla de corte
- [ ] Config plugin → `HostApduService` en el manifest
- [ ] Un móvil emula tarjeta, el otro lee 32 bytes

> ### 🚨 REGLA DURA
> **Si al acabar el día 4 el NFC no mueve 32 bytes entre dos móviles reales, se
> entierra.** Se borra `transport/nfc.ts`, se quita del selector y se sigue con
> BLE + QR. Sin "un día más". La arquitectura de transportes ya está preparada para
> perder una capa sin que se caiga nada.

**Salida de fase:** un documento de una página con qué funciona y qué no. El plan de
las fases 1–4 se ajusta a esa realidad, no al revés.

---

## Fase 1 · Días 5–9 · Programa Anchor

- [ ] Día 5 — `anchor keys sync`, deploy a localnet, `open_slot` con test
- [ ] Día 6 — `redeem` con test del camino feliz
- [ ] Día 7 — `reclaim` + tests de casos límite (importe cero, importe excesivo,
      firmante no autorizado, mint incorrecto, owner incorrecto)
- [ ] Día 8 — **Test de integración con nonce**: firmar `redeem` offline, esperar,
      enviar. Y el test que más importa: **el doble gasto tiene que fallar**
- [ ] Día 9 — Deploy a devnet, dirección pública en el README

**Salida de fase:** programa en devnet, suite verde, doble gasto demostrado imposible.

---

## Fase 2 · Días 10–16 · App de punta a punta

Feo pero funcionando. Nada de pulir aquí.

- [ ] Día 10 — MWA connect/reauthorize, saldo real en pantalla
- [ ] Día 11 — Clave de dispositivo: generar, guardar, barrera biométrica
- [ ] Día 12 — **Cargar billetes**: crear nonces + `open_slot` vía MWA, cachear
- [ ] Día 13 — **Pagar**: `buildVoucher()` offline + transmisión por QR
- [ ] Día 14 — **Cobrar**: `verifyVoucher()` offline + niveles de verificación
- [ ] Día 15 — Cola de liquidación + tarea en background
- [ ] Día 16 — Transporte ganador del spike (BLE, y NFC si sobrevivió)

**Salida de fase:** el circuito completo funciona en modo avión. **Graba un vídeo
casero ese mismo día** — es tu red de seguridad si algo se rompe después.

---

## Fase 3 · Días 17–21 · Donde se gana el 25% de Mobile UX

- [ ] Día 17 — Diseño visual: los billetes tienen que *parecer* billetes
- [ ] Día 18 — **Dominios `.skr`** ← bonus SKR de $10.000
- [ ] Día 19 — Detección de Seeker, guiño a Seed Vault, animación del tap, háptica
- [ ] Día 20 — Estados de error: sin billetes, importe insuficiente, biometría
      cancelada, transporte caído, voucher inválido
- [ ] Día 21 — Historial + enlaces a Solscan + onboarding de primer uso

---

## Fase 4 · Días 22–25 · Pruebas reales

- [ ] Día 22 — Dos móviles, modo avión, en la calle. Anotar todo lo que falla
- [ ] Día 23 — Arreglar lo que salió
- [ ] Día 24 — Casos límite: batería baja, app matada, red intermitente, sesión MWA
      caducada, reinstalación con billetes vivos
- [ ] Día 25 — **Congelación de funcionalidad.** A partir de aquí solo bugs críticos

---

## Fase 5 · Días 26–29 · Entregables

- [ ] Día 26 — **Vídeo demo.** La toma del modo avión es el argumento entero.
      60–120s. Guion en `docs/DEMO-SCRIPT.md`
- [ ] Día 27 — **Pitch deck.** 10–12 slides. El slide del threat model es el que te
      separa del resto: enseña que entiendes tu propio sistema
- [ ] Día 28 — README, limpieza del repo, APK release firmado y probado desde cero
      en un móvil limpio
- [ ] Día 29 (**6 de octubre**) — **ENTREGAR**

---

## Mapa de fases a criterios de evaluación

| Criterio | 25% | Dónde se gana |
|---|---|---|
| Completion | ✅ | Fases 2 y 5. Que funcione + el vídeo |
| Technical depth | ✅ | Fase 1 + commits diarios de todo el mes |
| Mobile UX | ✅ | Fase 3 + el transporte que sobreviva al spike |
| Solana integration | ✅ | Fase 1. Programa propio, nonces, SPL |
| Bonus SKR | 🎁 | Día 18 |

---

## Preguntas abiertas para decidir en el spike

1. **¿Quién anuncia por BLE?** Probablemente el receptor. Confirmar el día 3.
2. **¿Sobrevive el NFC?** Se decide el día 4, con la regla dura.
3. **¿Devnet o mainnet para el vídeo?** Devnet es más seguro. Mainnet con importes
   diminutos es más impresionante. Decidir el día 25, no antes.
4. **¿Denominaciones fijas o importe libre al cargar?** El programa soporta ambas
   (`redeem` admite importe parcial con cambio). Las fijas venden mejor.

---

## Lo que NO entra — decidido y cerrado

❌ Importes parciales con cambio complejo · ❌ Multi-token · ❌ Modo comerciante/TPV
❌ iOS · ❌ Backend propio · ❌ Onboarding sin wallet · ❌ Recuperación social
