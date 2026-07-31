# Builder API — Propuestas con costo (T-6 KMS, T-7 Cloud Tasks)

> Recomendación general: **implementar AMBAS**. Costo combinado para el rango de uso típico de alpha/beta (<10k participantes/mes, <500 investigadores) cae por debajo de **$2 USD/mes**. Las cantidades crecen sub-linealmente con la carga, por lo que el ROI mejora a escala.
>
> Esta página separa las dos propuestas, las desglosa por componente y da fórmulas para que puedas re-correr los números cuando definas un perfil de uso.

---

## T-6 — Cifrado del token OSF manual en reposo (KMS)

### Bug que se arregla

`osfToken` se guarda **plaintext** en `users/{uid}` en Firestore. Cualquiera que obtenga una copia de la BD (dump, backup robado, regla de Firestore mal configurada, leak via Functions log, etc.) obtiene tokens OSF válidos de todos los usuarios. El attacker puede entonces:

- Listar / borrar / modificar archivos en la cuenta OSF de la víctima
- Crear / borrar componentes / nodos en proyectos de la víctima
- Leer datos privados de OSF si el token tiene scope `osf.full_read`

El daño es proporcional al *scope* del token (la víctima lo elige al generar). Tokens generados desde la UI de Builder piden `osf.full_read osf.full_write` → daño máximo.

### Mecanismo de fix

1. Aprovisionar GCP **Cloud KMS**: key ring (`builder-secrets`) + clave simétrica (`osf-token-key`).
2. Otorgar a la cuenta de servicio de Cloud Functions permiso `roles/cloudkms.cryptoKeyEncrypterDecrypter` sobre la clave.
3. En `osf-token.js` `handleSaveToken`:
   - Antes de `users.set({ osfToken })`, cifrar con `kms.encrypt({name: keyName, plaintext: token})`
   - Guardar el ciphertext (base64) en Firestore en lugar del plaintext
4. En `oauth/index.js` `getValidToken` (rama OSF manual):
   - Antes de devolver, descifrar con `kms.decrypt({name: keyName, ciphertext})`
5. Migración: script one-shot que recorre `users` collection, lee cada `osfToken`, cifra, escribe de vuelta. Usuarios nunca notan.

### Alternativa más barata: Secret Manager

En vez de KMS, se puede usar **Secret Manager** y guardar UN secreto que contenga *todas* las claves (formato JSON `{uid: token, ...}`). Más simple pero todo o nada — un leak del secret expone todos los tokens. KMS por usuario es más limpio.

### Componentes de costo (GCP Cloud KMS, región `us-central1`, abril 2026)

| Concepto | Precio | Quién lo causa | Frecuencia |
|---|---|---|---|
| **Versión de clave activa** | $0.06 / mes | Sistema (1 clave compartida) | Fijo |
| **Operación `encrypt`** | $0.03 / 10 000 | Investigador al guardar token OSF manual | Una por save (≤1 por investigador típico) |
| **Operación `decrypt`** | $0.03 / 10 000 | Cualquier acción que usa OSF (finalize, list, append, etc.) | Una por request al backend que toca OSF |
| **Storage extra Firestore** | Negligible (~50 bytes por token, igual que plaintext + few bytes overhead) | Investigador | Por usuario |

### Fórmula por usuario (investigador) y participante

**Por investigador** (con cuenta OSF manual conectada):
- `encrypt_ops` = 1 por save de token (rara vez >1/mes)
- `decrypt_ops` = N requests/mes que tocan OSF de su parte
  - Cada uno de sus experimentos genera ~1 decrypt por trial-finish (CASO 3) + 1 por list/download/delete vía dashboard

Si un investigador tiene 3 experimentos activos con 100 participantes/mes cada uno:
- ~300 finalizeSession/mes × 1 decrypt = 300 decrypts
- ~30 dashboard ops/mes × 1 decrypt = 30 decrypts
- **Total ~330 decrypts/mes ≈ $0.001/mes** (1/30 de centavo)

**Por participante**:
- 1 decrypt por finalizeSession trigger (CASO 1 o 3)
- = $0.000003 (3 millonésimas de dólar)
- 1M participantes ≈ $3/mes en decrypts

**Costo fijo**: $0.06/mes por clave (independiente de uso).

### Estimación total mensual

| Escala | Investigadores | Participantes/mes | Costo |
|---|---|---|---|
| Alpha actual | 10 | 1 000 | $0.06 + ~$0.003 = **~$0.06** |
| Beta | 100 | 10 000 | $0.06 + ~$0.03 = **~$0.09** |
| Producción | 1 000 | 100 000 | $0.06 + ~$0.30 = **~$0.36** |
| Escala alta | 10 000 | 1 000 000 | $0.06 + ~$3 = **~$3** |

Conclusión: **menos de $1/mes** hasta superar los 100k participantes. Trivial.

### Riesgos / decisión a tomar

- **Aprovar:** sí / no
- **Quién mantiene la clave:** el equipo (rotación cada N años recomendada)
- **Migración:** un script de un solo uso. ~30 min de desarrollo, ~5 min de ejecución para <10k usuarios.

---

## T-7 — Migración de `setTimeout` a Cloud Tasks

**Estado actual:** implementado. La implementación final usa Firebase task queue
functions, respaldadas por Cloud Tasks, en vez de un endpoint HTTP manual con
`CloudTasksClient`. Ver `SESSION_TIMEOUT_CLOUD_TASKS.md` para el flujo actual,
deploy, pruebas, costos y limites.

### Bug que se arregla

Código anterior en sesiones desconectadas (CASO 1 OSF + CASO 2 IndexedDB cleanup):

```js
setTimeout(async () => { ...finalize OSF or delete Firestore zombie... }, 30 * 60 * 1000);
```

Cloud Functions v2 mata la instancia ~10 minutos después de `res.send()`. El `setTimeout(30min)` **nunca dispara** en producción. Consecuencias:

- Sesiones OSF desconectadas sin IndexedDB: datos quedan en limbo en Firestore, nunca se suben a OSF → **pérdida de datos**
- Sesiones con IndexedDB abandonadas: Firestore queda con docs zombi → bloat / costo storage

### Mecanismo implementado

1. `finalizeDisconnectedSessions` escribe `resumeExpiresAt` y
   `resumeTimeoutTaskStatus: "pending"` en RTDB.
2. Encola `processSessionTimeout` con `getFunctions(app).taskQueue(...)` y
   `scheduleTime: new Date(resumeExpiresAt)`.
3. Al encolar correctamente, marca `resumeTimeoutTaskStatus: "queued"`.
4. Si el participante reconecta, RTDB queda `state: "resumed"` y la tarea vieja
   queda invalidada por mismatch de estado/`resumeExpiresAt`.
5. `processSessionTimeout` re-lee RTDB al dispararse. Solo procesa si la sesión
   sigue desconectada y el `expiresAt` del task coincide con RTDB.
6. Para IndexedDB expirado, borra `trials` en lotes de 500, borra el doc de
   sesión, escribe metadata `expired` y marca RTDB procesado.
7. Para OSF sin IndexedDB, llama `finalizeSession`, escribe metadata `expired` y
   marca RTDB procesado. Errores transitorios se reintentan por Cloud Tasks.

### Componentes de costo (GCP Cloud Tasks, región `us-central1`)

| Concepto | Precio | Quién lo causa |
|---|---|---|
| **Cuota gratuita** | **1 000 000 tasks / mes** | Todos los participantes/investigadores juntos |
| **Después del free tier** | $0.40 / millón de tasks | Idem |
| **Storage de la queue** | $0 (incluido) | Idem |
| **Ejecución del task** | Sólo el costo de la Cloud Function destino, que ya pagas | Idem |

### Fórmula por participante e investigador

**Una sesión genera (en el peor caso) 1 task de cleanup** — la que dispara cuando el participante se desconecta sin terminar. Sesiones que finalizan normalmente NO disparan task.

Tasa de abandono típica en experimentos online: ~15-25%. Asumamos 20%.

**Por participante**:
- E[tasks/participante] = 0.2
- Costo = 0.2 × $0.40/1M = $0.00000008
- 1M participantes ≈ 200 000 tasks × $0.40/1M = $0.08/mes

**Por investigador**: depende de cuántos participantes ejecuten su experimento. Investigadores no generan tasks por sí mismos (no participan).

### Estimación total mensual

| Escala | Participantes/mes | Tasks (20% abandono) | Costo |
|---|---|---|---|
| Alpha actual | 1 000 | 200 | **$0** (free tier) |
| Beta | 10 000 | 2 000 | **$0** (free tier) |
| Producción | 100 000 | 20 000 | **$0** (free tier) |
| Escala alta | 1 000 000 | 200 000 | **$0** (free tier) |
| Escala muy alta | 10 000 000 | 2 000 000 | $0.40 |

Conclusión: **gratis hasta 5M participantes/mes** (asumiendo 20% abandono). A escala más alta sigue siendo céntimos.

### Costos secundarios

- El task dispara la task queue function `processSessionTimeout`. Cada disparo cuesta lo mismo que el cleanup/finalize que debió ejecutar el timeout anterior (Cloud Functions invocation + Firestore reads/writes). **No es costo nuevo funcional**: es el costo correcto del trabajo que antes se perdía.
- Realidad: hoy NO pagamos ese costo porque el setTimeout nunca dispara. T-7 te "agrega" el costo correcto del cleanup que debió suceder. Pero ese costo es el mismo que ya pagas por finalize en CASO 3 (cuando el cliente sí termina bien) — solo lo extiendes al 20% que se desconecta.

### Riesgos / migración

- **Migración:** ninguna para sesiones nuevas. Sesiones zombi viejas no se
  corrigen retroactivamente salvo script one-shot opcional.
- **Permisos:** si falla el enqueue, revisar IAM (`cloudtasks.tasks.create` /
  `roles/cloudtasks.enqueuer`) para la cuenta de servicio de Functions.
- **Costo:** cada sesión desconectada resumible agrega normalmente dos
  operaciones de Cloud Tasks: enqueue + delivery attempt.

---

## Resumen ejecutivo

| Item | Costo fijo/mes | Costo variable | Decisión necesaria |
|---|---|---|---|
| **T-6 KMS** | $0.06 | <$0.50 hasta 100k participantes | Aprobar gasto + GCP setup |
| **T-7 Cloud Tasks** | $0 | $0 hasta 5M participantes | Implementado |
| **Combinado** | **$0.06/mes** | **<$0.50/mes a escala beta** | — |

T-7 es esencialmente gratis y ya esta implementado. T-6 es ~6 centavos al mes en escala alpha. Recomendación pendiente: **aprobar T-6**.

---

## Pendientes sin costo (ya pueden implementarse)

- **T-2 endpoint auth** — Firebase Auth Bearer token check en endpoints admin (publishExperiment, apiDeleteExperiment, osfManage, apiData con action=list/download/delete/updateSessionName). Participant endpoints (apiData default, apiDataComplete, apiCondition, uploadParticipantFile) permanecen públicos. Necesita coord frontend para mandar `Authorization: Bearer <token>`.

- **T-5 OAuth CSRF** — `state=uid` → `state = HMAC-firmado por backend con uid+provider+ts+nonce`. Endpoint `createOAuthState` (autenticado) que el cliente llama antes de redirigir a OAuth provider. Validación HMAC + ts<10min en cada callback.

- **T-3 dominio** — ya hecho en commit `0e5accf` (env vars `FIREBASE_APP_BASE_URL`, `OSF_OAUTH_CALLBACK_URL`, `OSF_POST_AUTH_REDIRECT_URL`, defaults a `test-e4cf9`).
