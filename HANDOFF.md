# Builder API — Pre-Refactor Handoff

> **Purpose:** drop-in context for a new Claude session. Read this + `ISSUES.md` and you have full picture without re-discovering it.
>
> **Status:** post Phase 1 + 2 fixes + Tier 1 + Tier 2 tests, **300/300 tests green**, **83.05% stmts** coverage, ready for refactor prep (or Tier 3 polish).

---

## 1. Project at a glance

- **Stack:** Firebase Functions v2, Node 20, ESM, `firebase-admin` 11.9, `firebase-functions` 4.8.
- **Role:** backend for [expbuilder](https://github.com/adndvlp/expbuilder) — jsPsych experiment builder. Frontend lives at `/Users/andresitopacheco/Desktop/workspace/Builder/JsPsych/client/`. Server-side helpers at `/Users/andresitopacheco/Desktop/workspace/Builder/JsPsych/server/`.
- **Concept:** investigators connect their OWN storage (Drive / Dropbox / OSF) via OAuth + publish their experiment HTML to their OWN GitHub repo with Pages. Builder is orchestrator — does NOT store the actual result data.
- **Project Firebase:** `test-e4cf9` (user confirmed). `builder-f43c3` appears in `oauth/callbacks/osf.js:23,249` + `JsPsych/client/src/pages/Settings/OsfToken.tsx:31`; user does NOT know where it came from, but OSF OAuth works in prod (so it likely exists somewhere). Treat as unknown and don't touch.
- **Stage:** alpha. Secrets rotation deferred until production push.

---

## 2. Mental model — critical flows

### 2.1 Combos cliente (set in `JsPsych/client/.../ExperimentSettings.tsx`)

Frontend defaults: `useIndexedDB=true`, `batchSize=0`, `resumeTimeoutMinutes=30`.

| combo | trial path | finalization |
|-------|-----------|--------------|
| **DEFAULT** IndexedDB ON + batch=0 | trial → IndexedDB local (nothing to Firestore) | `on_finish` calls **`apiDataComplete`** direct → storage. `needsFinalization=false` → trigger does NOT fire CASO 3 |
| IndexedDB ON + batch>0 | trial → IndexedDB + every N → Firestore (`apiData` with `data.trialsData`) | `on_finish` sends last batch + `needsFinalization=true` → trigger CASO 3 → `finalizeSession()` reads Firestore |
| IndexedDB OFF + batch=N | trial-by-trial direct to Firestore (`apiData`) | `needsFinalization=true` → CASO 3 → `finalizeSession()` |

Decision lives in client: `PublicConfiguration.ts:946`:
```js
const needsBackendFinalization = !(BATCH_CONFIG.useIndexedDB && BATCH_CONFIG.size === 0);
```

### 2.2 RTDB state machine

Client writes to `sessions/{experimentID}/{sessionId}` in RTDB. Server backend trigger `finalizeDisconnectedSessions` (in `sessions/index.js:765`) reacts.

```
client init       → set { connected:true, state:'initiated', useIndexedDB, resumeTimeoutMinutes }
                   + onDisconnect({ connected:false, state:'disconnected' })
first trial       → state:'in-progress'
on_finish ok      → cancel onDisconnect + set { connected:false, finished:true, needsFinalization, state:'completed' }
crash/close       → onDisconnect fires → trigger CASO 1/2 evaluates useIndexedDB
explicit finish   → set needsFinalization:true → CASO 3 → finalizeSession()
```

Trigger 3 CASOS (`sessions/triggers.js` + `sessions/timeout-tasks.js`):
- **CASO 1** (`!useIndexedDB`): server is source of truth. Drive/Dropbox PATCH immediately. OSF schedules durable `processSessionTimeout` via Cloud Tasks.
- **CASO 2** (`useIndexedDB`): datos en navegador. Cloud Tasks dispara limpieza Firestore zombi tras `resumeExpiresAt`; la tarea borra `trials` en lotes de 500, borra doc de sesión y marca `expired`.
- **CASO 3**: finalización explícita pedida por cliente. Llama `finalizeSession()`.

### 2.3 `finalizeSession()` — corazón del backend

Located: `sessions/index.js:394-759`. Steps:
1. `writeLog("finishSession")`
2. Read exp_doc → throws `EXPERIMENT_NOT_FOUND`
3. `getValidToken(storageProvider, owner)`
4. Read RTDB state via `getDatabase(app).ref(...).once()`
5. Read `sessions/{sid}` Firestore doc → throws `SESSION_NOT_FOUND`
6. Read trials subcollection → throws `NO_RESULTS`
7. Expand batches: each doc with `trialsData` string → `JSON.parse`
8. `deserializeFromFirestore` (now safe with `__json` sentinel — see S-1 fix below)
9. Sort by `clientTimestamp || 0`
10. Add metadata per trial (browser/OS/etc)
11. json2csv → CSV
12. Drive/Dropbox: download existing CSV if exists, concatenate, PATCH whole
13. OSF: just append
14. Paginated batch delete trials (S-3 fix — chunks of 500) + session doc deleted separately
15. Write `session_metadata` for investigator view

### 2.4 Storage providers (`sessions/storage.js`)

12 implementations: 4 funcs × 3 providers. `folderIdentifier` parameter has DIFFERENT semantics per function per provider — be careful:

| function | OSF folderIdentifier | Drive folderIdentifier | Dropbox folderIdentifier |
|----------|----------------------|------------------------|--------------------------|
| `createSession` | uploadLink URL | folderId | folderPath |
| `appendResult` | uploadLink URL | folderId | folderPath |
| `listSessions` | **componentId** | folderId | folderPath |
| `downloadSession` | **componentId** | folderId | folderPath |
| `deleteSession` | **componentId** | folderId | folderPath |
| `postFile` (legacy) | uploadLink URL | folderId | folderPath |

`handler.js` resolves OSF via `resolveOsfComponentId(exp_data)` helper (added in T-14 fix).

---

## 3. Sesión actual — historial completo

### Fase 0 — Reconocimiento (pre-sesión actual)
- Generado `ISSUES.md` (85 entradas: 14 CRIT, 28 HIGH, 35 MED, 8 LOW).
- Tests piloto 32 ✅ (validate-csv, validate-json, storage-{createSession, appendResult, listSessions}).
- Setup Jest ESM con `--experimental-vm-modules` Node 20.

### Fase 1 — Critical (6 fixes)
1. **`.env` migration**: `functions/.env` + `functions/.env.example` + `functions/.gitignore` actualizado. `oauth/index.js` + 4 callbacks ahora `process.env.*`. **Secrets viejos siguen en git history — rotación deferida hasta prod**.
2. **Delete `hosting/index.js`** (519 LOC dead+broken — usaba `crud-file-github.js` que no existe desde commit `2762c14 folder restructure`).
3. **Delete `ensure-resources.js`** (huérfano, solo usado por hosting/index.js).
4. **Cleanup `callbacks/github.js`**: removida `getGithubToken` duplicada (sigue en `oauth/github-token.js`).
5. **Generic `writeLog`** (T-16): switch hardcoded → `{[action]: increment(1)}`. Ahora todas las acciones se loggean.
6. **O-2**: `handleDisconnect` ahora limpia `osfToken` (singular manual) además de `osfTokens` (plural OAuth).
7. **T-14**: `handler.js` resuelve `osfComponentId` (no `osfUploadLink`) para list/download/delete OSF.
8. **T-15**: Drive query escape via `escapeDriveQueryValue` helper en `storage.js`, aplicado a 5 archivos.
9. **St-3**: OSF appendResult atómico — PUT a file URL existente crea nueva versión sin DELETE previo.
10. **T-8**: consolidé Firebase Admin init — quitada duplicación en 5 archivos, todos importan de `app.js`.
11. **E-4**: `deleteExperiment` ahora maneja rama OSF con `osfComponentId`.
12. **E-5**: `deleteExperiment` limpia `getDatabase(app).ref('sessions/${experimentID}').remove()`.
13. **S-3**: `finalizeSession` borra trials en chunks de 500 + session doc por separado.
14. **O-4**: OSF callback reutiliza proyecto "ExpBuilder" existente en vez de crear duplicado cada vez.

### Fase 1.5 — 80/20 (5 fixes refinados)
15. **getRedirectUri prod fix**: 3 callbacks ahora usan `process.env.FUNCTIONS_EMULATOR === "true"` (no `NODE_ENV` que NO se setea en Functions v2 deploy).
16. **T-17/E-9 base64 regex**: removido `/^([A-Za-z0-9+/=]+)$/` (matcheaba strings normales como `"abc"`, `"index"`). Ahora siempre decodifica base64 strings con strip de `data:` URL prefix.
17. **F-3 OSF deleteFolder**: lista archivos del componente y los borra uno por uno. NO borra el componente (preserva datos en caso colisión nombres).
18. **F-1 Drive createFolder/deleteFolder**: primera iteración filtra `'root' in parents`. Ya no matchea folders en "Shared with me".
19. **H-3 createdAt**: `handleAppendResult` ahora usa `new Date().toISOString()` (consistente con `handleCreateSession`).

### Fase 2 — High residual (2 fixes)
20. **S-1 deserializeFromFirestore**: sentinel explícito `{__json: "..."}`. Strings legítimos del cliente quedan intactos. **Wire format change** — sesiones in-flight con formato viejo verán arrays como JSON strings literales en CSV (pérdida acotada).
21. **E-7 setTimeout(2000)**: nueva helper `waitForGithubRepoReady` en `hosting/services.js`. Polls `GET /repos/{owner}/{repo}/branches/main` cada 500ms hasta 200, cap 30s.

### Fase Tier 2 — cobertura para refactor-safety (6 test files + 1 fix)
22. **`write-log.test.js`** (5 tests) — noop guards + T-16 generic action key + error swallow.
23. **`api-condition.test.js`** (6 tests) — validation, 400 paths, single-condition fast path, txn rotate, txn error.
24. **`oauth-github-token.test.js`** (8 tests) — getGithubToken Firestore paths + getGithubOwner HTTP paths.
25. **`experiment-createExperiment.test.js`** (13 tests) — per-provider wiring + token failure + folder failure + anonymous + getValidToken throw + `apiDeleteExperiment` HTTP wrapper.
26. **`hosting-services-full.test.js`** (19 tests) — createRepositoryGithub (5), uploadFileGithub (3), enableGithubPages (5, fake setTimeout for 2s wait), deleteRepositoryGithub (3), getRepositoryInfo (3).
27. **`storage-rest.test.js`** (23 tests) — downloadSession + deleteSession + postFile × 3 providers + unknown-provider fallback.
28. **NEW BUG FIX — createExperiment OSF userDoc.exists guard**: `experiment/index.js:52` previously called `userDoc.data().osfProjectId` without checking `userDoc.exists`. If the user document didn't exist, `.data()` returned `undefined` and dereferencing `.osfProjectId` threw a TypeError that was swallowed by the outer `try/catch` — surfaced as a cryptic `storageError` while the experiment doc was still persisted with `storageProvider: "osf"` but no `osfComponentId`/`osfUploadLink`. `publishExperiment` already guarded with `userDoc.exists`; this aligns them. Test: `experiment-createExperiment.test.js` "OSF with missing user doc falls back to folderPath (no TypeError)".

---

## 4. Tests existentes — estado actual

```
Total: 300 tests, 24 suites, ✅ todas verde
Tiempo: ~1.3s
```

### Suites + cobertura por dominio (24 suites)

| suite | tests | cubre |
|-------|-------|-------|
| `validate-csv.test.js` | 6 | `validateCSV` |
| `validate-json.test.js` | 6 | `validateJSON` |
| `storage-createSession.test.js` | 9 | createSession 3 providers + T-15 |
| `storage-appendResult.test.js` | 7 | appendResult 3 providers + St-3 |
| `storage-listSessions.test.js` | 4 | listSessions 3 providers |
| `storage-rest.test.js` | 23 | downloadSession + deleteSession + postFile × 3 providers |
| `oauth-getValidToken.test.js` | 10 | refresh paths Dropbox + OSF |
| `oauth-callbacks.test.js` | varias | 4 OAuth callbacks |
| `oauth-github-token.test.js` | 8 | getGithubToken + getGithubOwner |
| `osf-token-osfManage.test.js` | varias | osfManage 5 acciones |
| `sessions-handler.test.js` | 16 | 5 handlers + T-14 + H-3 |
| `sessions-apiData-router.test.js` | varias | apiData dispatch + handlePostFile |
| `sessions-apiDataComplete.test.js` | 11 | default hot path + providers |
| `sessions-finalizeSession.test.js` | 11 | orchestration + S-3 + S-1 |
| `sessions-finalizeDisconnected-trigger.test.js` | varias | CASOS 1/2/3 |
| `experiment-deleteExperiment.test.js` | 5 | E-4 + E-5 |
| `experiment-createExperiment.test.js` | 13 | createExperiment 3 providers + apiDeleteExperiment + userDoc fix |
| `experiment-publishExperiment.test.js` | varias | publishExperiment full flow |
| `participant-files.test.js` | 13 | HTTP + 3 providers + T-15 |
| `services-folder.test.js` | 13 | F-1 + F-3 |
| `hosting-services.test.js` | 4 | E-7 polling helper |
| `hosting-services-full.test.js` | 19 | 5 GH funcs (create/upload/pages/delete/info) |
| `api-condition.test.js` | 6 | 200/400/txn paths |
| `write-log.test.js` | 5 | T-16 generic + error swallow |

### Coverage por archivo (current)

```
Overall: 83.05% stmts / 72.37% branch / 84.03% funcs / 83.53% lines
```

**HIGH coverage (✅ refactor-safe):**
- `api-condition.js` 100% / `api-messages.js` 100% / `write-log.js` 100% / `github-token.js` 100%
- `hosting/services.js` 96.05%
- `osf-token.js` 96.89%
- `oauth/callbacks/*.js` 94–97%
- `validate-csv.js` 90% / `validate-json.js` 94%
- `storage.js` 87.76%
- `services/folder.js` 83.63%
- `participant-files.js` 84.4%

**MED coverage (refactor con cuidado):**
- `experiment/index.js` 79.23% (was 20%) — gaps en `publishExperiment` provider-change branch
- `oauth/index.js` 78.66% — funcs 40% (saveTokens unused branches)
- `sessions/handler.js` 71.2%
- `sessions/index.js` 71.85% — gaps en `finalizeSession` happy paths

**LOW coverage (refactor riesgoso si tocás esto):**
- `app.js` 0%, `functions/index.js` 0% (trivial — OK)

---

## 5. Plan pre-refactor — qué hacer EN ESTA SESIÓN

Goal del user: **subir cobertura para que refactor estructural (split de archivos largos) sea safety-netted por tests**. Los archivos largos a refactorizar más adelante son:

- `experiment/index.js` (~785 LOC, monstruo principal)
- `experiment/sessions/index.js` (~1227 LOC)
- `experiment/sessions/storage.js` (~1080 LOC)
- `oauth/osf-token.js` (~485 LOC)
- `oauth/callbacks/osf.js` (~313 LOC)

### Tier 1 — endpoints públicos sin pin (PRIORIDAD)

| nuevo test file | LOC tests aprox | cubre |
|-----------------|-----------------|-------|
| `experiment-publishExperiment.test.js` | ~250 | publishExperiment full flow + branches |
| `sessions-apiData-router.test.js` | ~120 | dispatch por action + `handlePostFile` legacy |
| `sessions-finalizeDisconnected-trigger.test.js` | ~200 | CASO 1, 2, 3 + edge cases |
| `oauth-callbacks.test.js` | ~150 | 4 callbacks + Electron/web branch + error redirect |
| `osf-token-osfManage.test.js` | ~180 | 5 acciones + error branches |

### Tier 2 — helpers atómicos pero usados everywhere

| nuevo test file | LOC | cubre |
|-----------------|-----|-------|
| `experiment-createExperiment.test.js` | ~80 | createExperiment per provider + `apiDeleteExperiment` HTTP wrapper |
| `hosting-services-full.test.js` | ~150 | 5 funciones GH restantes |
| `oauth-github-token.test.js` | ~40 | getGithubToken + getGithubOwner |
| `sessions-storage-rest.test.js` | ~100 | downloadSession + deleteSession + postFile 3 providers |
| `write-log.test.js` | ~30 | success + error |
| `api-condition.test.js` | ~40 | 200/400/txn paths |

### Tier 3 — branches finos

11. handler.js error paths (29% branch gap).
12. participant-files.js error branches (16% gap).
13. folder.js dropbox errors (16% gap).

**Meta:** ~85-90% stmts post Tier 1+2. Tier 3 = diminishing returns.

---

## 6. Decisiones explícitas del user (NO re-litigar)

- **Caveman mode active** for chat responses. Code/commits/security: write normal.
- **Stage alpha** — no rotar secrets hasta prod push.
- **builder-f43c3** — desconocido. OSF works en prod, así que asumo que existe en algún lado. No tocar.
- **T-2 endpoint auth** — deferred hasta que la app maneje token. Participant endpoints terminan en GH Pages (sin auth posible). Publish-related endpoints irán por app con Firebase Auth token. **NO implementar auth aún**.
- **T-7 Cloud Tasks** — implemented for session resume timeout. See `SESSION_TIMEOUT_CLOUD_TASKS.md`.
- **T-3 unified domain** — `test-e4cf9` confirmado, pero no tocar `builder-f43c3` en OSF callback hasta confirmar.
- **80/20 confirmado** — atacar lo que rompe flujos críticos, no exhaustive.
- **Tests "no fallen al escribirse, no al ejecutarse"** — verde al primer run. Si detectás bug nuevo escribiendo test, REPORTAR no arreglar sin permiso.

---

## 7. Pendientes sin input (no tocar sin OK explícito)

- **T-2 endpoint auth** (sec critical, requiere coordinación frontend)
- **T-5 OAuth state CSRF** (requiere coord frontend para nonce server-side)
- **T-6 KMS para osfToken plaintext** (requiere infra GCP)
- **T-7 Cloud Tasks para setTimeout en CASO 1 OSF** — implementado; no tocar salvo bugs/regresiones.
- **T-3 unificar dominio** (confirmar primero qué hace `builder-f43c3`)
- **Ho-2 setTimeout(2000) en `enableGithubPages`** (mismo patrón que E-7, fix análogo si quieren)
- Otras ~50 entradas MED/LOW del ISSUES.md no en 80/20

---

## 8. Pointers críticos — archivos a no perder de vista

```
functions/
├── app.js                         Firebase Admin init singleton
├── index.js                       Re-exports (11 Cloud Functions)
├── .env                          Secrets locales (gitignored)
├── .env.example                  Template

├── experiment/
│   ├── api-condition.js          GET condition (1 endpoint, sin tests)
│   ├── api-messages.js           Error message constants (100% covered)
│   ├── index.js                  ⚠️ 785 LOC — createExperiment, deleteExperiment,
│   │                              apiDeleteExperiment, publishExperiment
│   ├── participant-files.js      uploadParticipantFile (84% covered)
│   ├── hosting/
│   │   └── services.js           5 GH helpers + waitForGithubRepoReady (E-7 added)
│   └── sessions/
│       ├── index.js              ⚠️ 1227 LOC — apiData, apiDataComplete,
│       │                          finalizeSession, finalizeDisconnectedSessions
│       ├── handler.js            5 handlers + resolveOsfComponentId (T-14)
│       ├── storage.js            ⚠️ 1080 LOC — 4 funcs × 3 providers + escapeDriveQueryValue
│       ├── write-log.js          generic writeLog (T-16 fix)
│       ├── validate-csv.js       validateCSV
│       ├── validate-json.js      validateJSON
│       └── services/
│           └── folder.js         createFolder + deleteFolder (F-1 + F-3)

├── oauth/
│   ├── index.js                  getValidToken + saveTokens + OAUTH_CONFIGS
│   ├── osf-token.js              ⚠️ osfManage (5 actions in 482 LOC)
│   ├── github-token.js           getGithubToken + getGithubOwner
│   └── callbacks/
│       ├── dropbox.js            dropboxOAuthCallback
│       ├── github.js             githubOAuthCallback
│       ├── google-drive.js       googleDriveOAuthCallback
│       └── osf.js                osfOAuthCallback + refreshOSFToken + getOSFAuthorizationUrl

├── __tests__/
│   ├── __helpers__/
│   │   ├── fetch-mock.js         node-fetch mock (via moduleNameMapper)
│   │   └── firestore-mock.js     makeFsMock + makeReq + makeRes + makeSnapshot
│   └── *.test.js                 13 suites, 116 tests
└── jest.config.mjs
```

### Helpers test reutilizables (`__tests__/__helpers__/`)

- **`fetch-mock.js`** — node-fetch mock via `moduleNameMapper`. Use `fetchMock.__setMockResponses([{status, body}, ...])` + `fetchMock.__getCalls()`.
- **`firestore-mock.js`** — `makeFsMock()` retorna `{ db, getRef, getCol }`. Cached refs por path. Plus `makeReq`, `makeRes`, `makeSnapshot`.

### Mock pattern para ESM (use con `jest.unstable_mockModule` BEFORE dynamic import)

```js
import { jest } from "@jest/globals";
import { makeFsMock, makeReq, makeRes } from "./__helpers__/firestore-mock.js";

const fs = makeFsMock();
const mockGetValidToken = jest.fn();

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],  // identity unwrap
}));
jest.unstable_mockModule("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (n) => ({ __op: "increment", value: n }),
    serverTimestamp: () => ({ __op: "serverTimestamp" }),
  },
}));
jest.unstable_mockModule("../app.js", () => ({ db: fs.db, app: {} }));
jest.unstable_mockModule("../oauth/index.js", () => ({ getValidToken: mockGetValidToken }));
// ... etc

// DYNAMIC import AFTER mocks
const { someFunction } = await import("../experiment/sessions/index.js");
```

### Comandos clave

```bash
cd functions
npm test                      # full suite
npm test -- __tests__/X.js    # single suite
npm run test:coverage         # coverage report
npm run test:watch            # watch mode
```

---

## 9. Git state (en branch `refactor-with-tests`)

```
M .gitignore
M functions/.gitignore
M functions/package.json
M functions/oauth/{index,osf-token}.js
M functions/oauth/callbacks/*.js
M functions/experiment/{index,participant-files}.js
M functions/experiment/hosting/services.js
M functions/experiment/sessions/{handler,index,storage,write-log}.js
M functions/experiment/sessions/services/folder.js
D functions/experiment/hosting/index.js
D functions/experiment/ensure-resources.js
?? functions/.env
?? functions/.env.example
?? functions/__tests__/                  (13 test files + 2 helpers)
?? functions/jest.config.mjs
?? ISSUES.md
?? HANDOFF.md                            (this file)
```

No commits yet — branch state is all uncommitted. User wants to review diff before commit.

---

## 10. Next action (al re-empezar sesión)

**Tier 1 + Tier 2 ✅ DONE.** 300/300 verde, 83.05% stmts.

Opciones para próxima sesión:

1. **Refactor estructural** — green light. Empezar split de `experiment/sessions/index.js` (1227 LOC) o `experiment/index.js` (785 LOC). Tests pinean comportamiento.
2. **Tier 3 (diminishing returns)** — subir branch coverage de:
   - `handler.js` 71% → ~85% (error paths)
   - `sessions/index.js` 71% → ~85% (apiData router edge cases + finalizeSession alt-branches)
   - `experiment/index.js` 79% → ~90% (`publishExperiment` provider-change branches)
3. **Atacar ISSUES.md MED/LOW restantes** — ~50 entradas no en 80/20 original.

Sugerencia: ir a refactor — la suite ya tiene tests de orchestration cubriendo finalizeSession + handlers + apiData router. Tier 3 son branches finos, no críticos para refactor safety.
