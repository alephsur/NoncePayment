# NoncePayment — Documento de referencia

> Hackathon: **CLOCK IN** (Solana Mobile × RadiantsDAO)
> Cierre de entregas: **8 de octubre de 2026** · Entrega objetivo: **6 de octubre**
> Equipo: 1 persona · Stack: React Native / Expo + Anchor

---

## 1. Qué es NoncePayment

**Efectivo digital offline sobre Solana.**

Cargas "billetes" de USDC en el móvil mientras tienes internet — como sacar dinero de
un cajero. Después pagas a otro móvil **sin cobertura ninguno de los dos**: se acercan,
se tocan, el dinero cambia de manos. Cuando cualquiera de los dos vuelve a tener red,
la transacción se liquida en Solana automáticamente.

**El pitch en una frase:** *pagos en stablecoin que funcionan en modo avión.*

**El vídeo demo:** dos teléfonos con el modo avión visiblemente activado, tap,
"$20 recibidos", enciendes el wifi, aparece la transacción en Solscan. 90 segundos.

---

## 2. Reglas del hackathon (lo que hay que cumplir sí o sí)

### Rúbrica de evaluación — 4 criterios, 25% cada uno

| Criterio | Qué miran | Cómo lo atacamos |
|---|---|---|
| **Completion** | Que funcione + calidad del vídeo demo | Alcance recortado agresivamente; 4 días reservados para vídeo/deck |
| **Technical depth** | **Historial de commits en GitHub** + complejidad | Commits diarios desde el día 1; durable nonces + programa Anchor propio |
| **Mobile UX** | Diseño móvil + uso de capacidades nativas | NFC HCE, BLE, biometría, background tasks, Seed Vault |
| **Solana integration** | Interacción *significativa* con la red | Programa on-chain propio, SPL transfers, nonce accounts |

### Requisitos obligatorios de entrega

- [ ] **APK Android funcional** (obligatorio, no negociable)
- [ ] Integración de **Solana Mobile Stack + Mobile Wallet Adapter**
- [ ] **Repositorio Git accesible a los jueces** (revisan el historial de commits)
- [ ] **Vídeo demo** mostrando funcionalidad
- [ ] **Pitch deck** o presentación breve

### Restricciones

- **Una sola entrega** por persona/equipo. Múltiples entregas = descalificación automática.
- Solo equipos **sin financiación de VC/ángeles** optan a los premios en USDC.
- Los ganadores deben **publicar en la Solana dApp Store en los 30 días** posteriores al anuncio.
- Categoría única (no hay tracks). Aparte: **$10.000 en SKR** por la mejor integración de SKR.
- Aviso explícito de la organización:
  > *"Direct ports or PWA wrappers with little mobile optimisation will score poorly."*

### Premios

| Puesto | Premio |
|---|---|
| 1º | $30.000 USDC |
| 2º | $25.000 |
| 3º | $20.000 |
| 4º | $15.000 |
| 5º | $10.000 |
| 6º–10º | $5.000 cada uno |
| Bonus SKR | $10.000 en SKR |

Extras: co-marketing, colocación destacada en la dApp Store, dispositivos Seeker,
y una llamada con Anatoly Yakovenko.

---

## 3. Por qué esta idea puede ganar el primer premio

### Contexto competitivo

- La edición anterior tuvo **403 entregas de 66 países**.
- Los 10 ganadores anteriores: agregador de viajes, juego de cartas de memecoins,
  comercio con stablecoins, pagos retail, gestión de LP, y **cinco juegos/social**.
  → Ganan las **consumer apps**, no la infraestructura.
- En la dApp Store real (1.561 apps), el **#2 en uso es Moonwalk Fitness** — una app
  que paga por caminar. Es decir: **sensores del dispositivo**.

### El diferenciador

El patrón del ganador es claro: **algo físicamente imposible de hacer en una web app**.
Ahí se separan los 25% de "Mobile UX" y "Technical depth" del resto del campo.

NoncePayment no es solo "difícil de portar a web" — es **imposible**:
- HCE (Host Card Emulation) no existe en navegadores ni en iOS de forma abierta.
- BLE peripheral mode no existe en navegadores.
- Firmar sin red y liquidar después requiere almacenamiento seguro local.

Y aun así, es **útil de verdad**: mercados emergentes, metro, festivales, aviones,
zonas rurales, apagones. No es una demo técnica sin caso de uso.

---

## 4. Diseño técnico — el núcleo

### El problema

Pago offline: el pagador no tiene internet, el receptor tampoco. El pagador debe
entregar algo que sea (a) infalsificable, (b) canjeable después on-chain, y
(c) con riesgo de doble gasto acotado.

### La pieza clave: durable nonces

Una transacción normal de Solana **caduca en ~60 segundos** porque lleva un blockhash
reciente. Con un **nonce account**, la transacción usa un blockhash almacenado on-chain
que **no caduca nunca**. Firmas hoy, se ejecuta cuando sea.

Y la propiedad crítica: **avanzar el nonce invalida cualquier otra transacción firmada
con ese mismo nonce**. El propio runtime de Solana resuelve el doble gasto. No hay que
confiar en nadie.

> Documentado oficialmente por Solana para exactamente este caso de uso:
> https://solana.com/docs/core/transactions/durable-nonces

### Arquitectura: slots colateralizados

```
ONLINE — cargar billetes
  → El programa Anchor abre N "slots", cada uno con:
      · un nonce account (uso único, garantizado por el runtime)
      · USDC bloqueado en un PDA (vault)
  → Es literalmente "sacar 200$ del cajero en billetes"

OFFLINE — pagar
  → Firmas una transacción completa:
      [AdvanceNonce] + [CreateIdempotentATA(receptor)] + [redeem(slot_i, importe)]
  → La envías por NFC/BLE al otro móvil
  → El receptor VERIFICA LA FIRMA offline y ve el slot colateralizado
  → La guarda. Sin internet en ningún momento.

RECONEXIÓN — liquidar
  → Cualquiera de los dos la envía a la red
  → El programa paga al destinatario, devuelve el cambio al pagador, cierra el slot
```

Cada billete está **totalmente colateralizado** (el PDA tiene el dinero bloqueado) y es
**de un solo uso** (el nonce). Eso es dinero digital de verdad, no una promesa.

### El agujero que queda — y por qué es tu mejor slide

El pagador puede firmar dos billetes contra el mismo slot y dárselos a dos personas
distintas. Solo uno se liquida.

**Nadie puede eliminar esto sin red. Es matemáticamente imposible.** Lo que sí se puede
hacer, y hay que presentarlo así:

- El riesgo está **acotado** a la denominación de un billete, no al saldo entero.
- Es **atribuible**: el pagador va identificado por su dominio `.skr`.
- Es **detectable**: historial de liquidaciones on-chain → score de reputación visible
  antes de aceptar el pago.
- La ventana se cierra sola: liquidación automática en cuanto hay red.

Un pitch deck que dice *"esto es lo que NO resolvemos, y esto es por qué el riesgo
residual es aceptable"* puntúa mucho más alto que uno que finge que el problema no existe.

Ver `docs/THREAT-MODEL.md` para el análisis completo.

---

## 5. Transportes: tres capas, no una

**Regla de oro para un dev solo: no apuestes todo al NFC.**

| Capa | Para qué | Librería | Riesgo |
|---|---|---|---|
| **QR** | Fallback garantizado. Funciona siempre. | `expo-camera` | Ninguno |
| **BLE** | El caballo de batalla. Payload completo. | `react-native-ble-plx` | Medio |
| **NFC HCE** | El momento "wow" del vídeo. Solo handshake. | `react-native-hce` | **Alto** |

### El truco que reduce el riesgo del NFC

**El NFC no lleva el voucher entero.** Lleva solo un identificador de sesión de 32 bytes;
el BLE hace el intercambio real. Así el NFC queda reducido a su parte fácil y el vídeo
sigue teniendo el tap.

### Realidad de Expo + NFC

`react-native-hce` está mantenido y funciona, pero **Expo no soporta HCE de forma nativa**
(sigue siendo un feature request abierto). Necesitas:

- Un **config plugin propio** que inyecte el `HostApduService` y el `apduservice.xml`
  en el AndroidManifest → ya está escrito en `app/plugins/withNfcHce.js`
- **EAS Build con development client**

**Expo Go no sirve para nada de esto. Asúmelo desde el día 1.**

---

## 6. Integración SKR — el bonus de $10.000

Categoría casi vacía y barata de atacar. Dos integraciones, ~2 días:

1. **Dominios `.skr` como destinatario** — pagas a `david.skr`, no a una dirección
   base58. Encaja perfecto con la metáfora del efectivo y mejora la UX de verdad.
2. **Descuento de comisión pagando en SKR**, o cashback en SKR por liquidar rápido
   (alinea el incentivo económico con cerrar la ventana de riesgo de doble gasto).

Es el mejor ratio esfuerzo/premio de todo el hackathon.

---

## 7. Recortes de alcance — decididos AHORA, no en la semana 3

Siendo un dev solo, esto **NO entra**:

- ❌ Importes parciales con cambio complejo → denominaciones fijas ($1/$5/$20/$50)
- ❌ Multi-token → **solo USDC**
- ❌ Modo comerciante / TPV
- ❌ iOS
- ❌ Backend propio
- ❌ Onboarding sin wallet
- ❌ Recuperación social / multi-dispositivo

Las denominaciones fijas simplifican brutalmente el programa **y** refuerzan la metáfora
del efectivo. Es un recorte que además mejora el producto.

---

## 8. Los tres riesgos que pueden hundir el proyecto

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Polyfills de Solana en RN** (`Buffer`, `crypto.getRandomValues`, `structuredClone`) | Resolverlo el **día 1**, dentro del spike. Es el clásico que come dos días si te pilla el día 20. |
| 2 | **NFC HCE no funciona** | **Regla dura: si el día 4 no funciona, se entierra** y se sigue con BLE + QR. Sin discusión, sin "un día más". |
| 3 | **Quedarte sin tiempo para el vídeo** | Los últimos 4 días son **intocables**. Es literalmente el criterio de "Completion". |

---

## 9. Checklist de entrega

- [ ] APK firmado y probado en dispositivo real (no solo emulador)
- [ ] Repo público con historial de commits diarios desde el día 1
- [ ] README con arquitectura, instrucciones de build y demo GIF
- [ ] Vídeo demo (60–120s) — la toma del modo avión es el argumento
- [ ] Pitch deck (10–12 slides, incluyendo el slide del threat model)
- [ ] Programa desplegado en devnet con dirección pública verificable
- [ ] Integración `.skr` funcionando (bonus SKR)
- [ ] Entregado el **6 de octubre** (2 días de colchón)

---

## 10. Enlaces

**Hackathon**
- FAQ oficial: https://solanamobile.radiant.nexus/faq
- Registro: https://solanamobile.com/hackathon
- Ganadores edición anterior: https://blog.solanamobile.com/post/solana-mobile-hackathon-winners-announced

**Solana Mobile**
- Docs: https://docs.solanamobile.com/
- Mobile Wallet Adapter: https://docs.solanamobile.com/mobile-wallet-adapter/mobile-apps
- dApp Store publishing: https://docs.solanamobile.com/dapp-publishing/intro
- Detectar usuarios Seeker: https://docs.solanamobile.com/recipes/detecting-seeker-users
- SKR: https://solanamobile.com/skr

**Durable nonces**
- Docs oficiales: https://solana.com/docs/core/transactions/durable-nonces
- Guía: https://solana.com/developers/guides/advanced/introduction-to-durable-nonces
- Cookbook (offline tx): https://solana.com/developers/cookbook/transactions/offline-transactions

**Librerías nativas**
- react-native-hce: https://github.com/appidea/react-native-hce
- react-native-ble-plx: https://github.com/dotintent/react-native-ble-plx
- HCE en Expo (feature request): https://expo.canny.io/feature-requests/p/nfc-host-based-card-emulation
