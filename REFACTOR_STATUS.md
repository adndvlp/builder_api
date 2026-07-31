# Refactor Status — `refactor-with-tests` branch

Structural split of monolithic files. Behavior preserved. Tests as safety net.

**Tests:** `cd functions && npm test` — must stay at **424 passing / 29 suites** after each step.

---

## Done

### File 1: `functions/experiment/sessions/index.js` ✅

Split into:
- `sessions/serialize.js` (84 LOC) — `deserializeFromFirestore`, `mergeCsvByColumns`
- `sessions/finalize.js` (436 LOC) — `finalizeSession`
- `sessions/api/data-router.js` (264 LOC) — `apiData` + `handlePostFile` + `handleFinalizationError`
- `sessions/api/data-complete.js` (199 LOC) — `apiDataComplete`
- `sessions/triggers.js` (438 LOC) — `finalizeDisconnectedSessions`
- `sessions/index.js` (14 LOC) — re-export hub

Commits: `6b9bb7b`, `33f2735`, `50b23bf`, `1095cbd`, `4f8949e`

### File 2: `functions/experiment/sessions/storage.js` ✅

Split into:
- `sessions/storage/helpers.js` (104 LOC) — `escapeDriveQueryValue`, `mimeFromFilename`, `searchDriveFileByName`, `isSafeStorageId`, `rejectUnsafeIds`, etc.
- `sessions/storage/dropbox.js` (311 LOC)
- `sessions/storage/googledrive.js` (364 LOC)
- `sessions/storage/osf.js` (466 LOC)
- `sessions/storage/index.js` (139 LOC) — dispatch + re-exports
- `sessions/storage.js` (1 LOC) — `export * from "./storage/index.js"` (preserves test mock paths)

Commit: `4a16a19`

### File 3: `functions/experiment/index.js` ✅

Split into:
- `experiment/create.js` (143 LOC) — `createExperiment` — commit `6607029`
- `experiment/delete.js` (204 LOC) — `deleteExperiment` + `paginatedDelete` — commit `fa4842f`
- `experiment/api-delete.js` (51 LOC) — `apiDeleteExperiment` HTTP wrapper — commit `739190c`
- `experiment/publish/media.js` (79 LOC) — `uploadMediaFiles` — commit `b119f81`
- `experiment/publish/repo.js` (92 LOC) — `provisionRepository` + `enablePages` — commit `243eaae`
- `experiment/publish/provider-change.js` — provider switch branch — commit `44199ad`
- `experiment/publish/create-if-missing.js` — missing Firestore experiment branch — commit `463181d`
- `experiment/publish/index.js` (195 LOC) — `publishExperiment` orchestrator — commit `c961cd5`
- `experiment/index.js` (4 LOC) — re-export hub — commit `c961cd5`

Related fix before continuing this split:
- `experiment/sessions/finalize.js` imports fetch wrapper for test/runtime consistency — commit `a7de4ae`

---

### File 4: `functions/oauth/osf-token.js` ✅

Split into:
- `oauth/osf/save-token.js` — `handleSaveToken` — commit `90e0f17`
- `oauth/osf/validate-token.js` — `validateOSFToken`, `handleValidateToken` — commit `b1c3a1a`
- `oauth/osf/disconnect.js` — `handleDisconnect` — commit `241934f`
- `oauth/osf/create-component.js` — `handleCreateComponent` — commit `813e00f`
- `oauth/osf/upload-file.js` — `handleUploadFile` — commit `eafeab5`
- `oauth/osf-token.js` (61 LOC) — `osfManage` dispatch onRequest, kept as the test/public entry path

Tests after every split:
- Targeted: `npm test -- __tests__/osf-token-osfManage.test.js --runInBand`
- Full: `npm test` stayed at **424 passing / 29 suites**

### File 5: `functions/oauth/callbacks/osf.js` ✅

Split into:
- `oauth/callbacks/osf/callback.js` (138 LOC) — `osfOAuthCallback` — commit `d9abb2c`
- `oauth/callbacks/osf/config.js` (49 LOC) — OSF client IDs + redirect helpers — commit `b05c15b`
- `oauth/callbacks/osf/refresh.js` (46 LOC) — `refreshOSFToken` — commit `bd9a9d8`
- `oauth/callbacks/osf/authorization-url.js` (18 LOC) — `getOSFAuthorizationUrl` — commit `b7351d2`
- `oauth/callbacks/osf/project-init.js` (72 LOC) — ExpBuilder project reuse/creation — commit `061b902`
- `oauth/callbacks/osf/token-exchange.js` (32 LOC) — code→tokens exchange — commit `5ce0cc2`
- `oauth/callbacks/osf.js` (3 LOC) — re-export hub preserving test mock/import path

Tests after every split:
- Targeted: `npm test -- __tests__/oauth-callbacks.test.js __tests__/oauth-getValidToken.test.js __tests__/oauth-saveTokens-refresh.test.js --runInBand`
- Full: `npm test` stayed at **424 passing / 29 suites**

### File 6: `functions/experiment/sessions/handler.js` ✅

Split into:
- `experiment/sessions/create-session.js` (176 LOC) — `handleCreateSession` — commit `f8a399a`
- `experiment/sessions/append-result.js` (223 LOC) — `handleAppendResult` — commit `fb51899`
- `experiment/sessions/handler-helpers.js` (37 LOC) — folder identifier + token message helpers — commit `0bd9a8d`
- `experiment/sessions/list-sessions.js` (71 LOC) — `handleListSessions` — commit `7301870`
- `experiment/sessions/download-session.js` (77 LOC) — `handleDownloadSession` — commit `fd61389`
- `experiment/sessions/delete-session.js` (93 LOC) — `handleDeleteSession` — commit `50443c8`
- `experiment/sessions/handler.js` (6 LOC) — re-export hub preserving test mock/import path

Tests after every split:
- Targeted: `npm test -- __tests__/sessions-handler.test.js __tests__/sessions-handler-errors.test.js --runInBand`
- Full: `npm test` stayed at **424 passing / 29 suites**

---

## TODO

No pending refactor tasks remain from the documented File 3–6 scope.

---

## Constraints (do NOT violate)

- **Public exports unchanged.** `functions/index.js` re-exports these — they must keep working:
  `apiData, apiDataComplete, apiDeleteExperiment, apiCondition, finalizeDisconnectedSessions, dropboxOAuthCallback, githubOAuthCallback, publishExperiment, googleDriveOAuthCallback, osfManage, osfOAuthCallback, createOAuthStateEndpoint, uploadParticipantFile`

- **Test mock paths.** Tests use `jest.unstable_mockModule("../experiment/X.js", ...)`. Keep `X.js` reachable via the same path — either don't move the file, or leave a thin `export * from "./X/index.js"` shim (storage.js pattern). Updating test mocks is allowed per user instructions but avoided so far.

- **One commit per logical split.** Test after each. Roll back on failure.

- **Commit style: NO `Co-Authored-By` trailer.** Saved as feedback memory.

---

## Gotchas hit + solutions

1. **Read tool collapses control chars.** Reading the file shows `[ -]` for what is actually `[\x00-\x1F]` in source. **Solution:** verify via `git show HEAD:path | node -e "JSON.stringify(line)"` before copying regex strings to new files. Fixed once already in `sessions/api/data-router.js` `updateSessionName` validation — use `/[\x00-\x1F]/` form when writing new files.

2. **Large block deletes.** Edit tool struggles with 400+ line `old_string`. **Solution:** use `sed -i '' 'START,ENDd' file` to splice line ranges, then small Edit calls for import-list updates.

3. **`jest.unstable_mockModule` resolves by URL.** When `data-router.js` does `await import("../../../utils/auth.js")`, the resolved absolute URL is the same as what tests mock at `"../utils/auth.js"` (relative to `__tests__/`), so mocks fire correctly. Just keep relative paths correct from the new file's location.

4. **`createExperiment` is called by `publishExperiment`.** After moving to `create.js`, `publishExperiment` still needs it via `import { createExperiment } from "./create.js"`. Same for `deleteExperiment` used by `apiDeleteExperiment`.

---

## Commands

Resume in next session:
```
cd /Users/andresitopacheco/Desktop/workspace/Builder/builder_api
git status                         # only REFACTOR_STATUS.md should be untracked/modified if kept local
git log --oneline -15              # see refactor commits
cat REFACTOR_STATUS.md             # this file
cd functions && npm test           # baseline 424 / 29
```

No next refactor file is documented here. If continuing, first identify the next monolith with `wc -l` / `rg` and preserve the same constraints: public exports unchanged, mock paths preserved, one commit per logical split, full tests after each.
