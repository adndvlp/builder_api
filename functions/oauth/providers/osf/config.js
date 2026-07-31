// OSF OAuth credentials (desde functions/.env)
export const CLIENT_ID = process.env.OSF_CLIENT_ID;
export const CLIENT_SECRET = process.env.OSF_CLIENT_SECRET;

/**
 * Determina la URI de redirección según el entorno
 * @param {string} [explicitUri] - URI de redirección explícita (para Electron)
 * @returns {string} La URI de redirección apropiada
 */
export function getRedirectUri(explicitUri) {
  // Si se proporciona explícitamente (desde Electron), usarlo
  if (explicitUri) {
    return explicitUri;
  }

  const isProduction = process.env.FUNCTIONS_EMULATOR !== "true";

  if (isProduction) {
    // T-3: configurable via env. Must match the URL registered in the
    // OSF developer console (https://osf.io/settings/applications).
    return (
      process.env.OSF_OAUTH_CALLBACK_URL ||
      "https://us-central1-test-e4cf9.cloudfunctions.net/osfOAuthCallback"
    );
  } else {
    return "http://localhost:5173/oauth/osf/callback";
  }
}

/**
 * Obtiene la URI de redirección del cliente
 * @returns {string} La URI del cliente
 */
export function getClientRedirectUri() {
  const isProduction = process.env.FUNCTIONS_EMULATOR !== "true";
  const isElectron = false; // TODO: Detect electron environment if needed

  if (isElectron) {
    return "http://localhost:8888/settings";
  } else if (isProduction) {
    // T-3: configurable post-OAuth redirect.
    return (
      process.env.OSF_POST_AUTH_REDIRECT_URL ||
      "https://test-e4cf9.firebaseapp.com/settings"
    );
  } else {
    return "http://localhost:5173/settings";
  }
}
