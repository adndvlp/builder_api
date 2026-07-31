import { onRequest } from "firebase-functions/v2/https";
import { createOAuthState } from "../state-service.js";
import { requireAuth } from "../../utils/auth.js";

/**
 * T-5: HTTP endpoint that mints a signed OAuth `state` for the
 * authenticated user. Clients call this BEFORE redirecting to an OAuth
 * provider, then put the returned `state` value into the provider URL.
 *
 * Request (POST):
 *   { provider: "dropbox" | "googledrive" | "github" | "osf" }
 *   Authorization: Bearer <Firebase ID token>
 *
 * Response:
 *   { state: "<base64url-encoded HMAC-signed token>" }
 *
 * The state is bound to (uid, provider, timestamp, nonce). Callbacks
 * validate the HMAC + 10-minute freshness window before trusting the uid.
 */
export const createOAuthStateEndpoint = onRequest(
  { cors: true },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, message: "Method not allowed" });
      return;
    }

    const uid = await requireAuth(req, res, { requireMatchingUid: false });
    if (!uid) return;

    const provider = req.body?.provider;
    const ALLOWED = new Set(["dropbox", "googledrive", "github", "osf"]);
    if (!ALLOWED.has(provider)) {
      res.status(400).json({
        success: false,
        message: "provider must be one of: dropbox, googledrive, github, osf",
      });
      return;
    }

    try {
      const state = createOAuthState(uid, provider);
      res.status(200).json({ success: true, state });
    } catch (err) {
      console.error("createOAuthState failed:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },
);
