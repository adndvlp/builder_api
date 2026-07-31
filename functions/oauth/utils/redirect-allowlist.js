/**
 * T-4: open-redirect defense for OAuth callbacks.
 *
 * Callbacks previously accepted `req.query.redirect_uri` and forwarded it
 * verbatim to the OAuth provider in the token-exchange call. An attacker
 * could craft a Builder OAuth URL with `redirect_uri=https://attacker.com`,
 * trick a victim into clicking it, and have the OAuth provider POST the
 * authorization code back to attacker-controlled infrastructure.
 *
 * This helper validates the supplied URI against a hard-coded allowlist of
 * shapes (Electron localhost, Vite dev server, the configured production
 * base URL, and the OSF Cloud Function callback). If the URI doesn't match,
 * the helper returns `null` and the caller must fall back to the server-
 * derived default.
 *
 * @param {string|undefined} candidate - user-supplied redirect_uri
 * @returns {string|null} candidate if safe, null if rejected
 */
export function validateRedirectUri(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const allowedHosts = new Set([
    // Electron dev / build local server
    "localhost",
    "127.0.0.1",
  ]);

  // The configured production domain — env-driven (matches T-3 migration).
  const appBaseUrl = process.env.FIREBASE_APP_BASE_URL;
  if (appBaseUrl) {
    try {
      allowedHosts.add(new URL(appBaseUrl).hostname);
    } catch {
      // ignore malformed env
    }
  } else {
    allowedHosts.add("test-e4cf9.firebaseapp.com");
  }

  // OSF callback URL — env-driven.
  const osfCallback = process.env.OSF_OAUTH_CALLBACK_URL;
  if (osfCallback) {
    try {
      allowedHosts.add(new URL(osfCallback).hostname);
    } catch {
      // ignore
    }
  } else {
    allowedHosts.add("us-central1-test-e4cf9.cloudfunctions.net");
  }

  // Always allow cloud functions on the configured project (other callbacks).
  if (appBaseUrl) {
    try {
      const projectHost = new URL(appBaseUrl).hostname.split(".")[0];
      allowedHosts.add(`us-central1-${projectHost}.cloudfunctions.net`);
    } catch {
      // ignore
    }
  }

  if (!allowedHosts.has(parsed.hostname)) {
    return null;
  }

  // Enforce protocol: https in prod, http only for localhost dev.
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (!isLocal && parsed.protocol !== "https:") {
    return null;
  }
  if (isLocal && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  return candidate;
}
