# Builder API — Inventario de Inconsistencias y Bugs

**Fase 1 (reconocimiento, sin corregir).** Cada entrada lista: archivo, línea aproximada, comportamiento actual, comportamiento esperado y categoría. La intención es congelar todo lo encontrado para luego priorizar y corregir vía TDD.

**Leyenda de severidad:**
- 🔴 **CRIT** — riesgo de pérdida de datos, vulnerabilidad de seguridad o caída de producción.
- 🟠 **HIGH** — bug funcional con impacto directo en usuario.
- 🟡 **MED** — degradación silenciosa, race condition latente, deuda técnica con costo de soporte.
- 🟢 **LOW** — code smell, duplicación, dead code.

**Leyenda de categoría:** SEC (seguridad), DATA (integridad), RACE (concurrencia), DEAD (código muerto), API (contrato), PERF (rendimiento), VALID (validación), DUP (duplicación), OBS (observabilidad), UX (mensajes/UX), CFG (configuración).

---

## 0. Hallazgos transversales (afectan a varios módulos)

### T-1 🔴 CRIT · SEC — Credenciales OAuth (client_secret) commiteadas en el repositorio
- **Archivos:** `oauth/index.js:8-22`, `oauth/callbacks/dropbox.js:13-14`, `oauth/callbacks/github.js:52-53`, `oauth/callbacks/google-drive.js:13-15`, `oauth/callbacks/osf.js:13-14`.
- **Actual:** `clientId` y `clientSecret` de Dropbox, Google Drive, OSF y GitHub literal en el código fuente, además duplicados en varios archivos.
- **Esperado:** Cargar desde variables de entorno / Secret Manager. Rotar los 4 secretos inmediatamente porque están públicos en git.
- **Impacto:** Cualquiera con acceso al repo puede impersonar la app contra los 4 proveedores OAuth.

### T-2 🔴 CRIT · SEC — Endpoints HTTP sin autenticación
- **Archivos:** prácticamente todos los `onRequest` (`apiData`, `apiDataComplete`, `apiDeleteExperiment`, `publishExperiment`, `apiCondition`, `uploadParticipantFile`, `osfManage`, `githubCreate*`).
- **Actual:** Los endpoints aceptan `experimentID` o `uid` desde el body/query y operan sobre los datos del usuario sin verificar token de Firebase Auth ni que el caller controle ese `uid`.
- **Esperado:** Validar `Authorization: Bearer <Firebase ID token>` con `admin.auth().verifyIdToken()` y que `uid` decodificado coincida con `experimentData.owner` (o que la operación sea pública por diseño).
- **Casos concretos peligrosos:**
  - `apiDeleteExperiment` borra Firestore + repo GitHub + carpetas remotas con solo enviar `experimentID` + `uid`.
  - `publishExperiment` sube HTML arbitrario al repo GitHub del usuario solo con `uid`.
  - `handleListSessions`/`handleDownloadSession`/`handleDeleteSession` exponen los CSV de cualquier experimento conocido.
  - `osfManage` `saveToken`/`disconnect` permite escribir/borrar el OSF token de cualquier `uid`.

### T-3 🔴 CRIT · CFG — Doble dominio de producción y URLs hardcoded
- **Archivos:** `oauth/callbacks/dropbox.js:27,133`, `oauth/callbacks/github.js:66,157`, `oauth/callbacks/google-drive.js:28,132`, `oauth/callbacks/osf.js:30,230`.
- **Actual:** Dropbox/GitHub/Google Drive apuntan a `test-e4cf9.firebaseapp.com`. OSF apunta a `builder-f43c3.cloudfunctions.net` y `builder-f43c3.firebaseapp.com`. Son **dos proyectos Firebase diferentes** en código.
- **Esperado:** Una sola fuente de verdad (env var `APP_BASE_URL` / `OAUTH_REDIRECT_BASE_URL`). Resolver qué proyecto es el correcto.
- **Impacto:** Tras OAuth el usuario puede ser redirigido a un dominio distinto del que carga la app real → "no pasó nada" silencioso.

### T-4 🟠 HIGH · SEC — Open redirect en callbacks OAuth
- **Archivos:** `oauth/callbacks/dropbox.js:60`, `github.js:99`, `google-drive.js:61`, `osf.js:55,99`.
- **Actual:** El callback acepta `req.query.redirect_uri` y lo usa tal cual en el intercambio de token contra el proveedor.
- **Esperado:** Validar contra allowlist (`http://localhost:8888/callback`, `http://localhost:5173/...`, dominio de producción canónico).
- **Impacto:** Un atacante puede crear un link OAuth que redirige los tokens hacia un endpoint que controla.

### T-5 🔴 CRIT · SEC — CSRF en OAuth: `state = uid`
- **Archivos:** Todos los callbacks OAuth (`dropbox.js:42`, `github.js:81`, `google-drive.js:43`, `osf.js:85`).
- **Actual:** El parámetro `state` (anti-CSRF estándar OAuth) se usa para transportar el UID del usuario. Quien observe o adivine un `uid` puede iniciar un flujo OAuth contra ese usuario.
- **Esperado:** Generar un token aleatorio servidor-side, almacenarlo asociado al `uid`, devolverlo como `state`. Validar al volver.
- **Impacto:** Account-takeover por session-fixation OAuth.

### T-6 🔴 CRIT · SEC — Token OSF manual guardado en texto plano en Firestore
- **Archivo:** `oauth/osf-token.js:154-163`, `oauth/index.js:165` (lee y devuelve el campo plano).
- **Actual:** El token personal de OSF se guarda como `osfToken` (string plano) en `users/{uid}`.
- **Esperado:** Cifrar en reposo (KMS) o no almacenar el token largo y forzar OAuth-only.
- **Impacto:** Cualquier read leak (rule de Firestore mal puesta, dump, backup) entrega el token.

### T-7 ✅ FIXED · API/RACE — Timeouts de sesiones desconectadas migrados a Cloud Tasks
- **Archivos:** `experiment/sessions/triggers.js`, `experiment/sessions/timeout-tasks.js`, `functions/index.js`.
- **Antes:** OSF sin IndexedDB y sesiones con IndexedDB dependían de `setTimeout(..., timeoutMs)` dentro del trigger RTDB para limpiar/finalizar tras 30 min.
- **Ahora:** `finalizeDisconnectedSessions` escribe `resumeExpiresAt` y encola `processSessionTimeout` como Firebase task queue function respaldada por Cloud Tasks. La tarea re-lee RTDB, valida que siga desconectada y que `resumeExpiresAt` coincida; si no coincide, no hace nada.
- **Cobertura:** `sessions-timeout-tasks.test.js` y `sessions-finalizeDisconnected-trigger.test.js`.
- **Nota:** Los `setTimeout` restantes en hosting son sleeps cortos dentro de polling awaited, no trabajo diferido post-handler.

### T-8 🟠 HIGH · DATA — Cada subdirectorio re-inicializa Firebase Admin
- **Archivos:** `oauth/osf-token.js:7-10`, `oauth/callbacks/*.js:7-10`, `experiment/participant-files.js:7-10`.
- **Actual:** Cinco módulos hacen su propio `initializeApp()` con guard `getApps().length === 0`. `app.js` ya lo hace.
- **Esperado:** Importar `db`/`app` desde `app.js` siempre.
- **Impacto:** Imports en orden incorrecto crean apps duplicadas y warnings; cualquier configuración futura del app principal (settings, credentials) no aplica a los otros.

### T-9 🟠 HIGH · DEAD — `crud-file-github.js` no existe pero está importado
- **Archivos:** `experiment/hosting/index.js:9`, `experiment/ensure-resources.js:2-5`.
- **Actual:** Importan `from "../../crud-file-github.js"` / `from "./crud-file-github.js"` que **no existe** en el repo (las funciones viven en `experiment/hosting/services.js`).
- **Esperado:** Eliminar `hosting/index.js` entero (no se exporta en `functions/index.js`), o renombrar a `services.js`. `ensureResourcesExist` se importa lazy desde `githubUpdateHtml` (que tampoco se exporta) → cadena muerta.
- **Impacto:** Cualquier intento de invocar `githubCreateAndPublish`, `githubDeleteRepository`, `githubGetRepository`, `githubUpdateHtml` o `ensureResourcesExist` falla en runtime al resolver el import.

### T-10 🟡 MED · API — `cors: true` + headers CORS manuales redundantes
- **Archivos:** `experiment/sessions/index.js`, `experiment/index.js:354-355`, `oauth/osf-token.js:54-55`, `experiment/hosting/index.js:26,159,253`, callbacks OAuth.
- **Actual:** `onRequest({ cors: true })` ya configura CORS; los handlers agregan `res.set("Access-Control-Allow-Origin", "*")` arriba.
- **Esperado:** Elegir uno. `cors: true` es preferible (incluye preflight). Si se necesita allowlist específica, pasar array a `cors`.

### T-11 🟡 MED · UX — Mensajes de error filtran detalles internos
- **Actual:** Muchos endpoints devuelven `error: error.message` directo (`apiDataComplete`, `apiDeleteExperiment`, `publishExperiment`, `osfManage`, etc.).
- **Esperado:** Loggear el detalle, devolver mensaje genérico al cliente.

### T-12 🟡 MED · PERF — Sin timeouts ni reintentos en `fetch` a APIs externas
- **Actual:** Cada `fetch` a Dropbox/Drive/OSF/GitHub corre sin `AbortSignal.timeout(...)`, sin retry y sin backoff para 429/5xx.
- **Esperado:** Wrapper con timeout (e.g. 30s) y reintentos para errores transitorios.
- **Impacto:** Una API externa lenta cuelga la function hasta el deadline (~540s); 1 rate-limit corta el flujo completo.

### T-13 🟠 HIGH · DUP — Selección de `folderIdentifier` por proveedor repetida en 6+ lugares
- **Archivos:** `sessions/index.js:213-222, 353-361, 548-556`, `handler.js:392-397, 468-473, 550-555`.
- **Actual:** El mismo `if (storageProvider === "googledrive") ... else ...` se repite. Peor: los valores que se pasan no son consistentes (ver T-14).
- **Esperado:** Helper `getFolderIdentifier(expData)`.

### T-14 🔴 CRIT · API — Contrato inconsistente del parámetro `folderIdentifier` para OSF
- **Detalle clave:**
  - `handler.js` (list/download/delete) pasa `exp_data.osfUploadLink` como `folderIdentifier` (`handler.js:397,473,555`).
  - `storage.js` (list/download/delete OSF) trata `folderIdentifier` como **`componentId`** (`storage.js:536, 696, 864`).
  - `sessions/index.js` (finalize/append) sí pasa `osfUploadLink` y `storage.js` (`createSession`, `appendResult`) lo trata como `uploadLink` (`storage.js:138, 345`).
- **Resultado:** Listar/descargar/borrar sesiones OSF está roto — se hace `fetch("https://api.osf.io/v2/nodes/<uploadLink>/files/")` que devuelve 404.
- **Severidad:** funcional crítica para usuarios de OSF.

### T-15 🔴 CRIT · SEC — Inyección en queries de Google Drive
- **Archivos:** `storage.js:74, 262, 494, 653, 821`, `sessions/index.js:573, 1000`, `participant-files.js:278`, `sessions/services/folder.js:60, 279`.
- **Actual:** `name='${fileName}'` y `'${folderIdentifier}' in parents` se construyen por interpolación. Drive usa `\` como escape; un nombre con `'` o `\` rompe la query o filtra otros archivos.
- **Esperado:** Sanitizar (`escape = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")`) o usar la librería oficial `googleapis`.

### T-16 🟠 HIGH · OBS — `writeLog` solo registra 2 de N acciones
- **Archivo:** `experiment/sessions/write-log.js`.
- **Actual:** El switch interno solo maneja `saveData` y `getCondition`. El resto (`createSession`, `appendResult`, `finishSession`, `listSessions`, `downloadSession`, `deleteSession`, `createExperiment`, `deleteExperiment`, `saveCompleteExperiment`) se silencia: la función retorna `true` sin escribir.
- **Esperado:** Genérico — `log_doc_ref.set({ [action]: FieldValue.increment(1) }, { merge: true })`.
- **Impacto:** Cualquier dashboard/observabilidad basado en `logs/{experimentID}` muestra solo 2 contadores.

### T-17 🟠 HIGH · DATA — `Buffer.from(content, "base64")` detectado por regex frágil
- **Archivos:** `experiment/index.js:705`, `experiment/hosting/index.js:457`.
- **Actual:** `if (/^([A-Za-z0-9+/=]+)$/.test(fileContent)) { fileContent = Buffer.from(...) }`. El regex matchea cualquier string solo de letras/dígitos/`+/=`. Strings normales como `"abc"` o `"index"` matchean → se intentan decodificar como base64 → contenido corrupto.
- **Esperado:** Decidir vía MIME / cabecera data-URL / flag explícito `isBase64`.

---

## 1. `experiment/sessions/index.js` (1227 LOC) — pipeline de resultados

### S-1 🔴 CRIT · DATA — `deserializeFromFirestore` rompe strings legítimos que empiezan por `{` o `[`
- **Líneas:** 24-54.
- **Actual:** Cualquier valor string que empiece con `[` o `{` se intenta `JSON.parse`. Si parsea con éxito, se reemplaza el string por el objeto.
- **Caso real:** Una respuesta de texto libre `"[OK]"` o `'{nada que ver}'` → si parsea (a veces sí), se rompe el tipo. Peor, si el cliente envía datos crudos como `'[1,2,3]'` que quería texto, se convierten a array.
- **Esperado:** Solo deserializar campos marcados explícitamente (lista de keys) o pasar metadata `__serialized: true`.

### S-2 ✅ FIXED · DATA — Limpieza/finalización diferida ahora usa Cloud Tasks (ver T-7)
- **Archivos:** `experiment/sessions/triggers.js`, `experiment/sessions/timeout-tasks.js`.
- OSF sin IndexedDB y sesiones con IndexedDB ya no dependen de `setTimeout(30min)`.
- La limpieza de IndexedDB expirado borra `trials` en lotes de 500, borra el doc de sesión, escribe `session_metadata` con `state: "expired"` y marca RTDB como procesado.

### S-3 🔴 CRIT · DATA — Borrado de trials con `db.batch()` sin paginar (límite 500)
- **Líneas:** 705-717.
- **Actual:** `trials_snapshot.docs.forEach((doc) => batch.delete(doc.ref))` + `batch.delete(session_ref)`. Si una sesión tiene >499 trials, el commit lanza `INVALID_ARGUMENT: maximum 500 writes per batch`. El CSV ya se subió a storage, pero los trials quedan en Firestore (datos zombi).
- **Esperado:** Paginar por chunks de 500 (`bulkWriter` recomendado).

### S-4 🟠 HIGH · DATA — Concatenación PATCH asume mismas columnas en CSV existente
- **Líneas:** 627-639.
- **Actual:** Se descarga el CSV existente, se quita la primera línea del nuevo CSV (header) y se concatenan. Si el header nuevo tiene columnas distintas (campo agregado/quitado en el experimento), los datos quedan desalineados sin error.
- **Esperado:** Re-alinear columnas: parsear ambos, unión de campos, reemitir.

### S-5 🟠 HIGH · DATA — Sort de trials por `clientTimestamp || 0` puede caotizar orden
- **Líneas:** 504-508.
- **Actual:** Trials sin `clientTimestamp` quedan todos con `0` y mantienen orden de inserción de Firestore (no determinístico) entre sí.
- **Esperado:** Fallback a `trial_index` o a un timestamp server.

### S-6 🟠 HIGH · API — Búsqueda Drive sin escape (T-15)
- **Líneas:** 573, 1000.

### S-7 🟠 HIGH · DATA — Nombre de archivo sin sanitización (`${experimentID}_${sessionId}.csv`)
- **Líneas:** 569.
- **Actual:** `experimentID` o `sessionId` con `/` o `\` rompen rutas en Dropbox/Drive/OSF. Sin validación inicial.
- **Esperado:** Validar formato (regex `^[a-zA-Z0-9_-]+$`).

### S-8 🟡 MED · DATA — Si parseo de batch falla, se pierden silenciosamente los trials
- **Líneas:** 484-497.
- **Actual:** `try { JSON.parse(trialsData) } catch { console.error; }` — el catch no agrega el batch como trial individual ni rastrea cuántos trials se perdieron.
- **Esperado:** Reportar al cliente o re-encolar.

### S-9 🟡 MED · API — `apiDataComplete` `session_metadata.set({...}, { merge: true })` sin campos completos
- **Líneas:** 252-279.
- **Actual:** Solo guarda `sessionId`, `completedAt`, `storageProvider`, `fileUrl`. No `state`, `metadata` (browser, OS), `createdAt`. La vista del investigador ve menos datos que con `finalizeSession`.
- **Esperado:** Generar metadata equivalente.

### S-10 🟡 MED · API — `apiDataComplete` no marca el experimento como con sesión
- **Líneas:** 132-294.
- **Actual:** No incrementa `exp_data.sessions` (sí lo hacen `handleCreateSession` y `handlePostFile`).
- **Esperado:** Decidir: si batch=0 cuenta como sesión, incrementar.

### S-11 🟡 MED · OBS — `console.log(finalCsv)` (línea 545) puede ser GB
- **Líneas:** 545.
- **Actual:** Log entero del CSV antes de subir; con sesiones largas se imprime megas. Stackdriver corta y cobra log volume.
- **Esperado:** Log con `length` o primeras 200 chars.

### S-12 🟡 MED · API — Caso "se reconectó" para OSF detectado dentro del bloque "se desconectó"
- **Líneas:** 884-899.
- **Actual:** El branch que detecta `afterData.connected === true && beforeData?.connected === false` está anidado dentro del `if (isNowDisconnected && wasConnected && !useIndexedDB)`. Pero `isNowDisconnected = afterData.connected === false`. Por lo tanto **`afterData.connected === true` es imposible aquí** → código muerto.
- **Esperado:** Mover la rama "reconectó" al nivel superior.

### S-13 🟡 MED · API — `updateSessionName` sin validar largo / contenido
- **Líneas:** 90-108.
- **Actual:** Acepta cualquier `sessionName` (string) y lo escribe.
- **Esperado:** Validar largo (<= 200) y caracteres.

### S-14 🟠 HIGH · API — Acción "delete" en `apiData` no valida ownership
- **Líneas:** 71-73.
- **Actual:** Cualquiera que envíe `action=delete` + `experimentID` + `sessionId` borra la sesión. Cumple ya con T-2.

### S-15 🟢 LOW · DUP — Construcción de `folderIdentifier` (T-13).

### S-16 🟡 MED · API — En CASO 3 (`needsFinalization=true`), el chequeo de transición depende de `beforeData?.connected === true`
- **Líneas:** 786, 1136.
- **Actual:** `wasConnected` requiere snapshot previo con `connected: true`. Para sesiones que nunca pasaron por `connected=true` (e.g. creadas ya desconectadas), CASO 3 no las finaliza.
- **Esperado:** Considerar también `wasConnected === undefined` si `needsFinalization=true`.

### S-17 🟡 MED · DATA — `finalState = sessionState === "abandoned" ? "abandoned" : "completed"` ignora otros estados
- **Líneas:** 721.
- **Actual:** Si `sessionState === "expired"`, se reporta como "completed".

---

## 2. `experiment/sessions/storage.js` (1071 LOC) — wrappers de proveedores

### St-1 🔴 CRIT · API — `folderIdentifier` significa distinta cosa por función (ver T-14)
- Resume el inconsistente uso entre `createSession`/`appendResult` (uploadLink OSF) vs `listSessions`/`downloadSession`/`deleteSession` (componentId OSF).

### St-2 🟠 HIGH · DATA — Dropbox `mode: "overwrite"` en `appendResult` puede pisar datos
- **Líneas:** 197-213.
- **Actual:** Si dos requests concurrentes hacen `appendResult` para la misma sesión, el segundo sobrescribe al primero sin error.
- **Esperado:** Usar `mode.update` con `parent_rev` (precondition).

### St-3 🔴 CRIT · DATA — OSF `appendResult` borra el archivo y luego lo recrea (race + pérdida)
- **Líneas:** 354-407.
- **Actual:** Lista → encuentra el archivo → `DELETE` → `PUT` nuevo. Si el `PUT` falla por cualquier motivo (red, rate-limit, 5xx), los datos previos quedan borrados y los nuevos no se suben → **pérdida total**.
- **Esperado:** Subir nuevo con nombre versionado, validar éxito, recién luego borrar el viejo. O reemplazar `appendResult` por la API de versionado de OSF.

### St-4 🟡 MED · PERF — `listSessions` sin paginación
- **Líneas:** 444 (Dropbox), 494 (Drive), 539-547 (OSF).
- **Actual:** Dropbox `list_folder` devuelve `has_more` que se ignora (>2000 archivos truncados). Drive sin `pageToken` (default 100). OSF JSON:API página de 10.
- **Esperado:** Loop hasta agotar.

### St-5 🟠 HIGH · DATA — Drive list usa `name contains '...'`
- **Líneas:** 494.
- **Actual:** `name contains '${experimentID}_'` puede traer archivos de otros experimentos cuyo `experimentID` contenga al solicitado (e.g. `exp1` también captura `exp10_xxx.csv`).
- **Esperado:** Filtrar en cliente por `name.startsWith(...)` o usar `name = ...` exacto. Mejor: combinar con `startsWith` usando dos cláusulas.

### St-6 🟡 MED · CFG — `postFile` Drive hardcodea `mimeType: "application/json"` y `Content-Type: application/json` (línea 993, 1006, 1046)
- **Actual:** Aunque el archivo sea CSV.

### St-7 🟡 MED · API — `createSession` Drive y `appendResult` Drive devuelven `participantNumber: 1` constante
- **Líneas:** 71, 135, 166, 258, 314, 341, 423.
- **Actual:** Campo "muerto" / engañoso. Lo real lo provee `handler.js`. Si un caller confía en esto, recibe 1 siempre.

### St-8 🟠 HIGH · DATA — Drive multipart body comienza con `\r\n--boundary`
- **Líneas:** 105-112, 1001-1008.
- **Actual:** Según RFC 2046 la primera parte debe empezar con `--boundary\r\n` (sin CRLF previo). Drive lo tolera, pero la otra forma multipart en `participant-files.js:239-250` está bien.
- **Esperado:** Normalizar.

### St-9 🟢 LOW · DUP — Patrón "search-by-name → handle response" repetido 5 veces.

### St-10 🟡 MED · API — `dropbox.createSession` retorna `{ error: "Session already exists" }` (sin `errorCode`); el caller distinto al test por status
- **Líneas:** 38-40.
- **Actual:** Inconsistente con la rama Drive que sí setea `errorCode: 409`.

### St-11 🟡 MED · VALID — Respuestas sin guardias defensivos (`filesData.data[0]`)
- **Líneas:** 371, 559-565, 587, 718, 744, 886, 912.
- **Actual:** Suponen estructura JSON:API perfecta. Falta `?.` en varios accesos profundos. Si OSF devuelve estructura distinta (mantenimiento, edge case), throw no controlado.

---

## 3. `experiment/index.js` (771 LOC) — publish + delete experiment

### E-1 🔴 CRIT · SEC — `apiDeleteExperiment` sin auth (ver T-2)
- **Líneas:** 308-339.

### E-2 🟠 HIGH · DATA — `createExperiment` hace `set` sin merge → sobrescribe campos si el doc ya existe
- **Líneas:** 89-108.
- **Actual:** `await experimentRef.set({ title, ...providerFields, storageProvider, active:true, sessions:0, ... })`. Si por error se llama dos veces, se resetea `sessions` a 0, `maxSessions`, etc.
- **Esperado:** `{ merge: true }` o pasar por `experimentRef.create()`.

### E-3 🟠 HIGH · DATA — `createExperiment` impone defaults agresivos
- **Líneas:** 99-105.
- **Actual:** `useValidation: true`, `allowJSON: true`, `allowCSV: true`, `requiredFields: ["trial_type"]`, `nConditions: 1`, `currentCondition: 0`. Si un experimento se crea desde `publishExperiment` con campos personalizados ya en el cliente, se descartan.
- **Esperado:** Defaults sólo si el caller no provee, o configuración explícita.

### E-4 🟠 HIGH · DATA — `deleteExperiment` no borra recursos OSF
- **Líneas:** 141-186.
- **Actual:** El switch solo maneja `googledrive` y `dropbox` (línea 143-147). Si `storageProvider === "osf"`, `folderIdentifier` queda undefined → no borra el componente OSF. Datos quedan huérfanos en OSF.

### E-5 🟠 HIGH · DATA — `deleteExperiment` no limpia Realtime DB `/sessions/<experimentID>`
- **Líneas:** 245-292.
- **Actual:** Limpia `session_metadata`, `participant_files`, `trials`, `sessions` (Firestore) y borra el doc del experimento. NO toca Realtime Database (`/sessions/{experimentID}/...`). Esto deja huérfanas las sesiones activas y dispara el trigger `finalizeDisconnectedSessions` con `EXPERIMENT_NOT_FOUND`.
- **Esperado:** `getDatabase(app).ref("sessions/" + experimentID).remove()`.

### E-6 🟡 MED · DATA — Borrado de subcollections sin paginar respecto al snapshot
- **Líneas:** 246-277.
- **Actual:** `sessionMetaSnapshot = ...get()` carga TODOS los docs en memoria. Para experimentos enormes (10k sesiones), excede memoria de la función.
- **Esperado:** `bulkWriter` o `recursiveDelete`.

### E-7 ✅ FIXED · API — `publishExperiment` ya no espera 2s a ciegas
- **Archivos:** `experiment/publish/repo.js`, `experiment/hosting/services.js`.
- **Ahora:** `waitForGithubRepoReady` hace polling bounded sobre la branch `main` hasta que GitHub la reporte lista o se alcance el cap.

### E-8 🟠 HIGH · DATA — Cambio de storage provider no migra ni borra el viejo
- **Líneas:** 466-617.
- **Actual:** Cuando `currentProvider !== newProvider`, se crea la nueva carpeta y se actualiza Firestore, pero **no se borra la carpeta anterior** ni se migran las sesiones existentes.
- **Esperado:** Confirmar con el usuario; opcionalmente borrar / migrar.

### E-9 🟠 HIGH · DATA — Subida de media base64 con regex frágil (T-17)
- **Líneas:** 705-707.

### E-10 🟡 MED · PERF — Subida secuencial de media files
- **Líneas:** 692-727.
- **Actual:** `for (const file of mediaFiles)` con `await`. Para 50 archivos = 50× latencia.
- **Esperado:** `Promise.all` con limit (p-limit) — recordar rate limit de GH (5000/h).

### E-11 🟡 MED · UX — Failures de media files solo se loggean, response sigue siendo 200/201
- **Líneas:** 718-725.
- **Actual:** Si 10 de 50 archivos fallan, el response no lo refleja.
- **Esperado:** Incluir `mediaUploadResults: [{ filename, success, error }]` en la respuesta.

### E-12 🟡 MED · VALID — `repoName` no validado
- **Líneas:** 375.
- **Actual:** Permite cualquier string. GitHub rechaza algunos caracteres devolviendo 422.
- **Esperado:** Regex `^[a-zA-Z0-9._-]+$`.

### E-13 🟠 HIGH · DATA — OSF: si `userData` undefined, crash en `userData.osfProjectId`
- **Líneas:** 50-52 (createExperiment), 502-506 (publishExperiment).
- **Actual:** `userDoc.data()` puede ser undefined si la doc no existe; el código asume que sí.

### E-14 🟡 MED · CFG — Endpoint puede crear proyecto OSF "ExpBuilder" en cada cambio de storage
- **Líneas:** 405-444, 513-549.
- **Actual:** Si el usuario no tiene `osfProjectId`, se crea proyecto cada vez que se invoca `publishExperiment` con OSF → duplicados.

---

## 4. `experiment/sessions/handler.js` (607 LOC)

### H-1 🔴 CRIT · API — `handleListSessions`/`handleDownloadSession`/`handleDeleteSession` rotos para OSF (T-14)
- **Líneas:** 397, 473, 555.

### H-2 🟠 HIGH · API — `handleCreateSession` retorna `currentCondition` antes de incrementarlo
- **Líneas:** 119-136.
- **Actual:** Transacción devuelve `currentCondition` (valor pre-incremento). Primera sesión recibe `participantNumber = 0`. Probablemente intencional, pero confuso con la `apiCondition.js` que también devuelve pre-incremento.
- **Esperado:** Documentar el contrato `participantNumber base 0` o cambiar a base 1.

### H-3 🟡 MED · DATA — Inconsistencia de `createdAt` (ISO string vs serverTimestamp)
- **Líneas:** 165 (`handleCreateSession`: ISO), 327-328 (`handleAppendResult`: serverTimestamp).
- **Actual:** Dos paths que crean session docs usan tipos distintos para el mismo campo.

### H-4 🟡 MED · DATA — Contador `sessions` se incrementa aún cuando no se creó documento de sesión
- **Líneas:** 174-177.
- **Actual:** Para batchSize=0 no se crea el doc en Firestore pero el contador igual sube. Inconsistencia con `handleDeleteSession` (que decrementa siempre).

### H-5 🟡 MED · DATA — `handleDeleteSession` decrementa sin verificar que fuera contado
- **Líneas:** 581-585.
- **Actual:** Decrementa por cualquier sesión borrada. Combinado con H-4, el contador se desviva.

### H-6 🟡 MED · DATA — `trialId = ${clientTimestamp}_${trialIndex}` permite colisión
- **Líneas:** 301.
- **Actual:** Si el cliente envía dos trials con mismo timestamp + index (race), el segundo sobrescribe al primero.
- **Esperado:** Anexar `crypto.randomUUID()` o `firestore.collection().doc().id`.

### H-7 🟡 MED · DATA — Para batches con `batchNumber === undefined`, `trialId = "batch_undefined_0"`
- **Líneas:** 296.
- **Actual:** Dos batches consecutivos con cliente buggy sobrescriben mutuamente. Aceptado silenciosamente.

### H-8 🟡 MED · DATA — `sanitizeForFirestore` es asimétrico (array nested → JSON.stringify, object nested → recurse)
- **Líneas:** 13-46.
- **Actual:** El comportamiento difiere para `obj.foo = { bar: [...] }` (objeto guardado como objeto) vs `obj.foo = [{bar:1}]` (array → JSON.stringify). Inconsistencia que rompe `deserializeFromFirestore` (S-1).

### H-9 🟡 MED · VALID — Validation falla cuando `allowJSON=false`
- **Líneas:** 255-266.
- **Actual:** Solo intenta JSON validation. Si `exp_data.allowJSON === false`, `valid` se queda en `false` y devuelve `INVALID_DATA`. No hay path "appendResult acepta CSV".
- **Esperado:** Documentar que appendResult es JSON-only o agregar soporte CSV.

### H-10 🟡 MED · API — `isBatchConcatenated` detecta string-vacío como NO batch
- **Líneas:** 251-252.
- **Actual:** `trialsData && typeof === "string"` requiere truthy. Un cliente que envía `trialsData: ""` cae al path de trial individual.

### H-11 🟡 MED · CFG — `handleCreateSession` requiere `activeConditionAssignment=true` aun para `nConditions === 1`
- **Líneas:** 113.
- **Actual:** Si el investigador apaga `activeConditionAssignment`, no puede ni siquiera crear sesiones (que necesitan participantNumber).

---

## 5. `experiment/hosting/index.js` (519 LOC) y `hosting/services.js` (414 LOC)

### Ho-1 🔴 CRIT · DEAD — `hosting/index.js` entero está muerto / roto (T-9)
- **Detalles:** Importa `../../crud-file-github.js` inexistente y `getGithubToken` de `oauth/callbacks/github.js` que no exporta esa función. Ninguno de sus 4 exports (`githubCreateAndPublish`, `githubDeleteRepository`, `githubGetRepository`, `githubUpdateHtml`) se re-exporta en `functions/index.js`.
- **Esperado:** Borrar el archivo o reescribirlo apuntando a `hosting/services.js` y a `oauth/github-token.js`. Confirmar que ningún cliente externo lo invoca (probablemente safe).

### Ho-2 ✅ FIXED · API — `enableGithubPages` usa polling bounded
- **Archivo:** `experiment/hosting/services.js`.
- **Ahora:** `enableGithubPages` consulta `/pages` hasta obtener `html_url` o agotar el presupuesto bounded. El `setTimeout` restante es sleep awaited entre intentos, no trabajo diferido post-handler.

### Ho-3 🟡 MED · DATA — `createRepositoryGithub` no distingue "ya existía" de "creado" (ambos `success:true, existed:true|false`)
- **Líneas:** 75-118.
- **Actual:** Algunos callers querrán saber si ya existía. Está en `existed`, ok, pero el log "Repository created" se imprime incluso cuando existed=true.

### Ho-4 🟡 MED · API — `uploadFileGithub` no maneja archivos >1 MB (GitHub Contents API limit)
- **Líneas:** 138-210.
- **Actual:** Para >1 MB, GitHub devuelve 413. Para >100 MB, requiere Git LFS. Sin manejo.
- **Esperado:** Validar `Buffer.byteLength(content)` previo y devolver mensaje útil.

### Ho-5 🟡 MED · API — `enableGithubPages` 422 (ya habilitado) tratado como error
- **Líneas:** 271.
- **Actual:** Condición `!enableResponse.ok && enableResponse.status !== 201` excluye 201 pero no 422.

### Ho-6 🟢 LOW · DUP — Fetch GitHub user info repetido en `hosting/index.js` y `github-token.js` (ver T-13).

---

## 6. `oauth/osf-token.js` (485 LOC) y `oauth/index.js` (307 LOC)

### O-1 🔴 CRIT · SEC — Token OSF plaintext (ver T-6).

### O-2 🟠 HIGH · DATA — `handleDisconnect` borra `osfTokens` pero el resto del código lee `osfToken`
- **Líneas:** 239-248.
- **Actual:** Set a null en `osfTokens` (plural), `osfTokenValid:false`, etc. Pero el token manual está en `osfToken` (singular). El disconnect **no borra el token manual**.
- **Esperado:** Limpiar también `osfToken: null`.

### O-3 🟠 HIGH · API — `handleSaveToken` valida solo lectura del proyecto, no escritura
- **Líneas:** 127-151.
- **Actual:** Hace `GET /nodes/<projectId>` para validar acceso. Un token read-only pasa. Más tarde, las uploads fallan.
- **Esperado:** Validar que el scope incluya escritura.

### O-4 🟠 HIGH · DATA — `osf.js` callback crea siempre un proyecto "ExpBuilder" nuevo
- **Líneas:** 141-178.
- **Actual:** Cada vez que el usuario hace OAuth con OSF, se crea otro proyecto "ExpBuilder". Si re-conecta, duplica.
- **Esperado:** Listar nodos del usuario y reutilizar el existente con `title === "ExpBuilder"`.

### O-5 🟡 MED · API — `osfManage` `validateToken` recibe `uid` de `req.query` pero `saveToken` de `req.body`
- **Líneas:** 96-179.
- **Actual:** Inconsistencia: `validateToken` solo soporta query, `saveToken`/`disconnect` solo body.
- **Esperado:** Aceptar ambos uniformemente.

### O-6 🟡 MED · API — `getValidToken` para OSF cae a token manual aun si OAuth expiró sin refresh
- **Líneas:** 153-168.
- **Actual:** Si el refresh OAuth falla, fallback a `osfToken` manual. Si el manual ya no es válido pero `osfTokenValid===true` quedó en true (no se invalida en este path), uso de token caducado.
- **Esperado:** Volver a validar antes del fallback.

### O-7 🟢 LOW · CFG — `token_type` con casing distinto por provider (`"Bearer"` vs `"bearer"`).

---

## 7. `experiment/participant-files.js` (397 LOC)

### P-1 🟠 HIGH · SEC — Endpoint público sin auth + límite (T-2)
- **Líneas:** 35-171.
- **Actual:** Cualquiera con `experimentID` válido puede subir archivos al storage del owner.
- **Impacto:** Vector de abuso de cuota / costo.

### P-2 🟠 HIGH · CFG — Sin límite de tamaño por archivo ni del array
- **Actual:** Memory 512MiB en config, pero un POST de un solo archivo de 400 MB base64 ya hace fallar la función (no llega a uploadear).
- **Esperado:** Validar `file.size` y rechazar > N MB.

### P-3 🟡 MED · API — `subdir` solo se aplica a Dropbox; Drive y OSF no usan subfolder consistente
- **Líneas:** 188-211.
- **Actual:** Drive crea subfolder "participant-files" via `getOrCreateDriveFolder`. OSF no crea subcomponente — los archivos quedan mezclados con los CSV de las sesiones en el mismo `osfstorage`.

### P-4 🟡 MED · API — `getOrCreateDriveFolder` race condition: dos requests crean dos subfolders
- **Líneas:** 277-307.
- **Actual:** No hay lock entre buscar y crear. Bajo concurrencia, dos requests pueden crear `participant-files` dos veces.

### P-5 🟡 MED · DATA — `subfolderId` se ignora si `uploadToGoogleDrive` recibe `parentFolderId` undefined
- **Líneas:** 218-275.
- **Actual:** Si `expData.driveFolderId` es undefined (experimento sin carpeta Drive), `getOrCreateDriveFolder` se llama con parent undefined → la query Drive `'undefined' in parents` matchea folders propios.
- **Esperado:** Validar `parentFolderId` antes.

### P-6 🟡 MED · DATA — `uploadToOSF` `Content-Type: mimeType || "application/octet-stream"` (correcto), pero el wrapper de `storage.js` para OSF usa `application/json` (T-6/St-6).

---

## 8. `experiment/sessions/services/folder.js` (353 LOC)

### F-1 🟠 HIGH · DATA — `createFolder` Drive busca folder por nombre **sin filtrar por parent en la primera iteración**
- **Líneas:** 58-78.
- **Actual:** Primera iteración: `currentParentId === null` → query no incluye `'<parent>' in parents`. La búsqueda matchea cualquier folder con ese nombre en cualquier ubicación del Drive (incluyendo "Shared with me"), por lo que retoma como `currentParentId` un folder ajeno.
- **Esperado:** En la primera iteración, filtrar `'root' in parents`.

### F-2 🟠 HIGH · DATA — Dropbox/Drive folder paths sin sanitizar
- **Actual:** Mismas razones que S-7. Path traversal trivial.

### F-3 🟠 HIGH · DATA — `deleteFolder` OSF borra el **componente entero** del proyecto
- **Líneas:** 324-346.
- **Actual:** Para OSF, `deleteFolder` hace DELETE de `nodes/<componentId>/` → borra **el componente y todos los archivos**, no solo la "carpeta del experimento".
- **Esperado:** Confirmar con el usuario antes; usar deletion soft o solo borrar archivos.

### F-4 🟡 MED · DATA — `createFolder` Drive: si el folder existe pero está en otra carpeta padre, lo trata como "existe" y no crea
- Consecuencia de F-1.

### F-5 🟡 MED · API — `createFolder` OSF: idéntica lógica que `osf-token.js` `handleCreateComponent` (T-13/DUP).

---

## 9. Archivos chicos

### Misc-1 🟡 MED · DUP — `oauth/github-token.js` y `oauth/callbacks/github.js` exportan ambos un `getGithubToken`
- Distintos archivos, misma función. Llamadas inconsistentes desde diferentes módulos.
- **Esperado:** Una sola fuente.

### Misc-2 🟢 LOW · OBS — `writeLog` retorna boolean pero todos los callers lo ignoran (`await writeLog(...)`).
- **Esperado:** Quitar el return o que loggee en error path.

### Misc-3 🟢 LOW · API — `validate-csv.js` y `validate-json.js` no exportan el error de validación, solo `true/false`
- Imposible distinguir "no parseable" de "falta campo requerido" para devolver mejor 4xx.

### Misc-4 🟡 MED · VALID — `validateJSON` para arrays acepta union de keys
- **Líneas:** 22-25.
- **Actual:** Si el array tiene 10 objetos y solo uno tiene `trial_type`, valida true.
- **Esperado:** Validar que TODOS los objetos tengan el campo (semántica más estricta).

### Misc-5 🟡 MED · CFG — `app.js` inicializa Firebase Admin sin opciones
- Aceptable en Functions runtime; documentar que se usa ADC.

---

## Resumen ejecutivo

**Total entradas:** ~85 (17 transversales + ~68 por módulo)

**Distribución por severidad:**
- 🔴 CRIT: 14
- 🟠 HIGH: 28
- 🟡 MED: 35
- 🟢 LOW: 8

**Prioridades sugeridas (no aplicar todavía — solo orden lógico para Fase 2 TDD):**
1. T-1 (rotar secretos), T-2 (auth en endpoints), T-5 (CSRF state), T-6 (cifrar token OSF), T-14 (contrato folderIdentifier OSF), T-15 (inyección Drive query).
2. S-2/S-3 (setTimeout y batch>500), St-3 (OSF delete-then-create), E-5 (RTDB cleanup), F-1 (Drive folder search).
3. Resto de HIGH.
4. MEDIUM y LOW.

**Notas operacionales:**
- El proyecto **funciona hoy** porque los happy paths son los probados manualmente. La mayoría de los bugs solo surgen con concurrencia, errores transitorios de proveedores externos, datos atípicos, o sesiones largas.
- Antes de cualquier refactor, fijar coverage con tests de caracterización (golden-master) sobre el comportamiento actual, incluyendo casos que **hoy fallan** — marcarlos con `it.skip` o anotación explícita para regresarlos en verde tras corregir.
