import { getAuth } from "firebase-admin/auth";
import { app } from "../app.js";

/**
 * T-2: Firebase Auth Bearer-token verification for admin endpoints.
 *
 * Splits the API surface in two:
 *
 *   - Public (no auth required): participant-runtime endpoints invoked from
 *     GitHub Pages HTML where Firebase Auth context isn't available —
 *     apiData (POST trial), apiDataComplete, apiCondition, uploadParticipantFile.
 *
 *   - Authenticated: investigator/admin endpoints invoked from the Builder
 *     app — publishExperiment, apiDeleteExperiment, osfManage, apiData with
 *     `action ∈ {list, download, delete, updateSessionName}`.
 *
 * Validates `Authorization: Bearer <Firebase ID token>` and (optionally)
 * that the body/query `uid` matches the decoded token's uid, so a logged-in
 * user can't act on another user's data even when they know the other uid.
 *
 * @param {Object} req
 * @param {Object} [opts]
 * @param {boolean} [opts.requireMatchingUid=true]
 *        When true, also assert `req.body.uid` or `req.query.uid` (whichever
 *        is provided) equals the authenticated uid.
 * @returns {Promise<{ok: true, uid: string}|{ok: false, status: number, message: string}>}
 */
export async function verifyFirebaseAuth(req, opts = {}) {
  const requireMatchingUid = opts.requireMatchingUid !== false;

  const authHeader =
    req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {
    return {
      ok: false,
      status: 401,
      message: "Missing or malformed Authorization header (expected Bearer token)",
    };
  }
  const idToken = match[1];

  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(idToken);
  } catch (err) {
    console.warn("verifyFirebaseAuth: token rejected:", err.message);
    return {
      ok: false,
      status: 401,
      message: "Invalid or expired Firebase ID token",
    };
  }

  if (requireMatchingUid) {
    const claimedUid = req.body?.uid ?? req.query?.uid;
    if (claimedUid != null && claimedUid !== decoded.uid) {
      return {
        ok: false,
        status: 403,
        message: "uid in request does not match authenticated user",
      };
    }
  }

  return { ok: true, uid: decoded.uid };
}

/**
 * Convenience wrapper that writes the 401/403 response and returns false if
 * auth failed, or returns the decoded uid if auth succeeded.
 *
 * Usage:
 *   const uid = await requireAuth(req, res);
 *   if (!uid) return; // response already sent
 */
export async function requireAuth(req, res, opts = {}) {
  const result = await verifyFirebaseAuth(req, opts);
  if (!result.ok) {
    res.status(result.status).json({
      success: false,
      message: result.message,
    });
    return null;
  }
  return result.uid;
}
