# Threat model

> Este documento es material de pitch deck, no solo de ingeniería. El slide que sale de
> aquí es probablemente el que más te separa del resto de entregas: demuestra que
> entiendes tu propio sistema en vez de fingir que no tiene bordes.

## 1. Lo que el protocolo garantiza

| Garantía | Cómo |
|---|---|
| **Los vouchers no se pueden falsificar** | Firma ed25519 verificada offline contra el mensaje exacto |
| **Un billete se gasta como máximo una vez** | Nonce de uso único, impuesto por el runtime de Solana |
| **Todo voucher está totalmente colateralizado** | Los fondos están bloqueados en un vault PDA antes de firmar nada |
| **La clave de dispositivo no puede vaciarte** | Solo puede gastar slots ya financiados, nunca el saldo completo |
| **Los vouchers no se pueden redirigir** | El destinatario está dentro del mensaje firmado |
| **Los metadatos no pueden mentir** | La verificación los contrasta con la transacción y rechaza si no cuadran |

## 2. El riesgo residual

**Ataque:** el pagador firma dos vouchers contra el mismo slot y se los entrega a dos
receptores distintos, ambos offline. Solo uno se liquidará. El otro se queda sin nada.

**Esto no se puede eliminar.** No es un fallo de implementación: es una imposibilidad
matemática. Sin un punto común de consenso, dos partes aisladas no pueden saber que se
les ha prometido lo mismo. Cualquier sistema de pago offline tiene esta propiedad,
incluidos los monederos de dinero electrónico con hardware seguro.

Lo que sí se puede hacer es **acotarlo, atribuirlo y cerrarlo rápido**:

| Mitigación | Efecto |
|---|---|
| **Denominaciones fijas** | La pérdida máxima es un billete, no tu saldo |
| **Identidad `.skr`** | El pagador es una persona identificable, no una dirección anónima |
| **Reputación on-chain** | El historial de liquidaciones es público y consultable |
| **Liquidación automática** | La ventana se cierra sola al primer instante de red |
| **Nivel de verificación visible** | El receptor sabe exactamente qué se ha comprobado |

## 3. La ventana de riesgo

El riesgo existe solo entre firmar y liquidar. La app lo minimiza de forma agresiva:

- Liquidación en background en cuanto vuelve la conectividad
- Liquidación inmediata al recibir si el receptor tiene red
- Cualquiera de las dos partes puede liquidar — no hace falta que sea el receptor
- El historial marca visualmente lo pendiente

En la práctica: segundos o minutos en ciudad, horas en el peor caso realista.

## 4. Otros vectores

| Vector | Estado |
|---|---|
| Móvil robado desbloqueado | Acotado a los billetes cargados. Biometría en cada pago |
| Replay del mismo voucher | Imposible: el nonce ya se avanzó y el slot está cerrado |
| Receptor manipula el voucher | Rompe la firma → rechazado |
| MITM en BLE | El voucher está firmado y dirigido; interceptarlo no sirve de nada |
| Clave de dispositivo extraída | Solo gasta slots ya financiados. Mitigación v2: rotación + `reclaim` |
| Censura del RPC | Cualquiera de las dos partes puede enviar, desde cualquier RPC |

## 5. Cómo contarlo en el pitch

Un slide. Tres bloques:

1. **Lo que garantizamos** — la tabla de §1
2. **Lo que no** — el doble gasto offline, y por qué es imposible para *cualquiera*
3. **Cómo lo acotamos** — la tabla de mitigaciones de §2

Cierre sugerido:

> *"No hemos resuelto el doble gasto offline. Nadie puede. Lo hemos convertido en un
> riesgo acotado, atribuible y de vida corta — que es exactamente lo que el efectivo
> físico lleva haciendo cinco siglos."*
