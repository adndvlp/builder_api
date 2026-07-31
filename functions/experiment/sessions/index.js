/**
 * Sessions module entry point. Re-exports the HTTP endpoints, the RTDB
 * trigger, and the internal `finalizeSession` helper used by callers in this
 * package. Implementation is split across:
 *   - serialize.js : deserializeFromFirestore + mergeCsvByColumns
 *   - finalize.js  : finalizeSession (internal orchestration)
 *   - api/data-router.js   : apiData HTTP entrypoint
 *   - api/data-complete.js : apiDataComplete HTTP entrypoint (batch=0)
 *   - triggers.js  : finalizeDisconnectedSessions RTDB trigger
 *   - timeout-queue.js / timeout-tasks.js : Cloud Tasks-backed delayed session expiration
 */
export { apiData } from "./api/data-router.js";
export { apiDataComplete } from "./api/data-complete.js";
export { finalizeSession } from "./finalization/finalize.js";
export { finalizeDisconnectedSessions } from "./finalization/triggers.js";
