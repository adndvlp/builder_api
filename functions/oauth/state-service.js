import crypto from "node:crypto";

/**
 * T-5: server-signed OAuth `state` parameter to prevent CSRF / login-fixation.
 *
 * The OAuth `state` was previously set to the authenticated user's UID,
 * which any third party who learned (or guessed) a uid could replay — the
 * attacker could craft an OAuth URL with `state=<victim_uid>` and have the
 * provider deposit ATTACKER tokens onto the VICTIM's user document.
 *
 * Fix: backend mints state as
 *   base64url({ uid, provider, ts, nonce, sig })
 * where `sig = HMAC-SHA256(secret, uid|provider|ts|nonce)`. The OAuth
 * provider returns this state untouched in the callback; the backend
 * re-derives the HMAC, checks `ts` is within 10 minutes, and only then
 * accepts the uid as the actor.
 *
 * The HMAC secret comes from env var `OAUTH_STATE_SECRET`. If missing in
 * production the helper throws — callers must set it before deploy.
 */

const TEN_MIN_MS = 10 * 60 * 1000;

function getSecret() {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) {
    if (process.env.FUNCTIONS_EMULATOR === "true") {
      // Local dev fallback so the emulator works without extra config.
      return "dev-only-oauth-state-secret-DO-NOT-USE-IN-PROD";
    }
    throw new Error("OAUTH_STATE_SECRET env var is not configured");
  }
  return secret;
}

function sign(uid, provider, ts, nonce) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${uid}|${provider}|${ts}|${nonce}`)
    .digest("base64url");
}

/**
 * Mint a signed state for `uid` initiating OAuth with `provider`.
 * @param {string} uid
 * @param {string} provider - "dropbox" | "googledrive" | "github" | "osf"
 * @returns {string} base64url-encoded JSON
 */
export function createOAuthState(uid, provider) {
  if (typeof uid !== "string" || uid.length === 0) {
    throw new Error("createOAuthState: uid required");
  }
  if (typeof provider !== "string" || provider.length === 0) {
    throw new Error("createOAuthState: provider required");
  }
  const ts = Date.now();
  const nonce = crypto.randomBytes(16).toString("base64url");
  const sig = sign(uid, provider, ts, nonce);
  const payload = { uid, provider, ts, nonce, sig };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Validate a `state` parameter coming back from an OAuth provider.
 * @param {string} stateParam
 * @param {string} expectedProvider
 * @returns {{ok: true, uid: string}|{ok: false, reason: string}}
 */
export function validateOAuthState(stateParam, expectedProvider) {
  if (typeof stateParam !== "string" || stateParam.length === 0) {
    return { ok: false, reason: "missing state" };
  }
  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf8"),
    );
  } catch {
    return { ok: false, reason: "state not base64url JSON" };
  }
  const { uid, provider, ts, nonce, sig } = payload || {};
  if (!uid || !provider || !ts || !nonce || !sig) {
    return { ok: false, reason: "state payload incomplete" };
  }
  if (provider !== expectedProvider) {
    return { ok: false, reason: "provider mismatch" };
  }
  if (Date.now() - ts > TEN_MIN_MS) {
    return { ok: false, reason: "state expired" };
  }
  const expectedSig = sign(uid, provider, ts, nonce);
  // Timing-safe comparison
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid HMAC" };
  }
  return { ok: true, uid };
}
