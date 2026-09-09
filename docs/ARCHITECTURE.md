# Arquitectura

## 1. El problema en una frase

Dos móviles sin conexión. Uno debe entregar valor al otro de forma que sea
**infalsificable**, **canjeable después** y con **riesgo de doble gasto acotado**.

## 2. Las tres piezas

### 2.1 Durable nonces — por qué la transacción no caduca

Una transacción normal de Solana lleva un `recentBlockhash` y muere en ~60 segundos
(150 slots). Inútil para firmar hoy y liquidar mañana.

Un **nonce account** es una cuenta de 80 bytes del System Program que guarda un
blockhash estable. Si tu transacción usa ese valor como `recentBlockhash` y su
**primera instrucción** es `AdvanceNonceAccount`, la transacción **no caduca nunca**.

La propiedad que lo convierte en dinero:

> Avanzar el nonce cambia el blockhash almacenado, lo que **invalida cualquier otra
> transacción firmada contra el valor anterior**.

Un nonce = un uso. Lo garantiza el runtime de Solana. Nosotros no tenemos que hacer nada.

### 2.2 Slots colateralizados — por qué el billete vale lo que dice

Cada billete es un `Slot` PDA con:

| Campo | Para qué |
|---|---|
| `owner` | wallet real del usuario. Recibe el cambio y la renta |
| `authorized_signer` | clave de dispositivo autorizada a gastarlo offline |
| `nonce_account` | el nonce emparejado, de uso único |
| `amount` | colateral bloqueado en el vault PDA |

El dinero **está bloqueado** en un vault PDA controlado por el programa. Un voucher no
es una promesa de pago: es una orden sobre fondos que ya están retenidos.

### 2.3 Clave de dispositivo — por qué no dependemos de la wallet offline

Esta es la decisión de arquitectura más importante del proyecto.

**Enfoque ingenuo:** firmar el voucher offline con Mobile Wallet Adapter / Seed Vault.
**Problema:** MWA implica cambiar de app, y no está garantizado que el flujo completo
funcione en modo avión. Es un riesgo enorme para el componente central del producto.

**Nuestro enfoque:** un patrón de *session key*.

```
Wallet real (Seed Vault, vía MWA)     Clave de dispositivo (SecureStore + biometría)
──────────────────────────────        ────────────────────────────────────────────
Solo ONLINE                            Funciona SIEMPRE, sin red
Custodia todo el saldo                 Solo puede gastar slots ya financiados
Autoriza la clave de dispositivo       Es nonce authority y fee payer
Firma `open_slot` y `reclaim`          Firma `redeem` offline
```

Tres ventajas de golpe:

1. **Elimina el mayor riesgo técnico** — nada del camino offline depende de MWA.
2. **Acota el radio de explosión** — si te roban el móvil desbloqueado, el atacante
   solo puede gastar los billetes cargados, nunca el saldo completo.
3. **Es una UX mejor** — pagar es una huella, no un salto a otra app.

Y MWA sigue integrado de verdad (requisito del hackathon): es lo que custodia el dinero.

## 3. Anatomía de un voucher

```
Transacción firmada (~599 bytes crudos / ~800 en base64 — medido en los tests)

  ix[0]  SystemProgram::AdvanceNonceAccount    <- obligatoriamente la primera
  ix[1]  CreateAssociatedTokenAccountIdempotent <- el receptor puede no tener ATA
  ix[2]  nonce_payment::redeem(amount)          <- el pago

  recentBlockhash = valor del nonce cacheado    <- no caduca
  feePayer        = clave de dispositivo
  firmas          = [clave de dispositivo]
```

600 bytes entran de sobra en un QR. Ese dato, medido y no estimado, es lo que valida
toda la estrategia de transportes.

## 4. Qué puede verificar el receptor sin red

`verifyVoucher()` comprueba, sin una sola llamada de red:

- ✅ firma ed25519 auténtica sobre el mensaje exacto
- ✅ la transacción es durable (`AdvanceNonceAccount` va la primera)
- ✅ llama a nuestro programa, instrucción `redeem`
- ✅ el destinatario soy yo
- ✅ el PDA del slot deriva del owner declarado
- ✅ los metadatos coinciden con la transacción firmada (si mienten, se rechaza)
- ❌ **que el slot exista y tenga colateral** ← imposible sin red

De ahí el enum `VerificationLevel`:

| Nivel | Qué significa |
|---|---|
| `CRYPTO_ONLY` | Todo lo verificable offline. La firma es real, la estructura es correcta |
| `CACHED_STATE` | Además, el slot estaba financiado en el último snapshot |
| `ONCHAIN_CONFIRMED` | Confirmado en la cadena. Certeza total |

La UI del receptor muestra el nivel explícitamente. Es honesto y además es buen producto.

## 5. Flujos

### Cargar (ONLINE)
```
Usuario elige denominaciones  →  MWA autoriza
  → por cada billete: crear nonce account + open_slot
  → cachear {slot, nonceValue} en el ledger local
  → prefinanciar la clave de dispositivo con ~0.01 SOL (fees + renta de ATAs)
```

### Pagar (OFFLINE)
```
Importe + destinatario  →  seleccionar el billete más pequeño que cubra
  → biometría  →  buildVoucher() [sin red]
  → transporte: NFC handshake → BLE, o QR
  → marcar el slot como gastado + encolar para liquidar
```

### Cobrar (OFFLINE)
```
Escuchar  →  recibir bytes  →  verifyVoucher() [sin red]
  → mostrar importe + nivel de verificación
  → encolar; si hay red, liquidar ya
```

### Liquidar (ONLINE, automático)
```
Tarea en background  →  ¿hay red?  →  enviar transacciones pendientes
  → el nonce garantiza que solo una prospera por slot
```

## 6. Decisiones de diseño y sus alternativas

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Vault por slot | Vault compartido + contabilidad | El compartido ahorra ~0.002 SOL/billete, pero el aislado es trivial de razonar y de auditar. Con 29 días, gana la simplicidad |
| Clave de dispositivo | Firmar con MWA offline | Elimina el mayor riesgo técnico del proyecto |
| Fee payer = clave de dispositivo | Fee payer = receptor | El receptor pagando evita prefinanciar SOL, pero obliga a que sea él quien envíe. Con nuestro enfoque cualquiera puede liquidar. Anotado como optimización v2 |
| Denominaciones fijas | Importe libre | Simplifica el programa, acota el riesgo y refuerza la metáfora del efectivo |
| Legacy `Transaction` | `VersionedTransaction` | Serialización y parseo más simples; no necesitamos ALTs |

## 7. Coste real de renta por billete

| Cuenta | Bytes | ~SOL |
|---|---|---|
| Nonce account | 80 | 0.00144 |
| Slot PDA | 156 | 0.00189 |
| Vault (token account) | 165 | 0.00204 |
| **Total por billete** | | **~0.0054 SOL** |

20 billetes ≈ **0.11 SOL**. Es recuperable vía `redeem` o `reclaim`, pero hay que
enseñárselo al usuario antes de cargar — de ahí `estimateNoteRentLamports()`.

Optimización obvia para v2: vault compartido, que se lleva por delante el 38% del coste.
