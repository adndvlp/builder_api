import { onRequest } from "firebase-functions/v2/https";
import fetch from "../../../utils/fetch-with-timeout.js";
import { db } from "../../../app.js";
import { validateRedirectUri } from "../../utils/redirect-allowlist.js";
import { validateOAuthState } from "../../state-service.js";

// Credenciales de Google OAuth (desde functions/.env)
const CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

// Función para determinar el REDIRECT_URI correcto basado en el request.
// Usa FUNCTIONS_EMULATOR (seteado automáticamente por Firebase Emulator)
// en vez de NODE_ENV (que NO se setea en deploy de Functions v2).
function getRedirectUri(req) {
  // Si viene de la app Electron (puerto 8888)
  if (req.get("referer")?.includes("localhost:8888")) {
    return "http://localhost:8888/callback";
  }
  // Si es emulador local
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    return "http://localhost:5173/google-drive-callback";
  }
  // Producción web. T-3: derive from FIREBASE_APP_BASE_URL.
  const base =
    process.env.FIREBASE_APP_BASE_URL || "https://test-e4cf9.firebaseapp.com";
  return `${base}/google-drive-callback`;
}

// Endpoint para el callback de OAuth de Google Drive
export const googleDriveOAuthCallback = onRequest(async (req, res) => {
  // Permitir CORS para desarrollo local
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const code = req.query.code;
  const rawState = req.query.state;

  if (!code || !rawState) {
    return res.status(400).send("Missing code or state");
  }

  // T-5: signed-state required.
  const stateCheck = validateOAuthState(rawState, "googledrive");
  if (!stateCheck.ok) {
    return res.status(400).send(`Invalid OAuth state: ${stateCheck.reason}`);
  }
  const uid = stateCheck.uid;

  console.log(
    "Received callback with code:",
    code ? "present" : "missing",
    "uid:",
    uid,
  );

  try {
    console.log("Exchanging code for tokens...");

    // Determinar el REDIRECT_URI correcto
    // T-4: validate caller-supplied redirect_uri against allowlist.
    const REDIRECT_URI =
      validateRedirectUri(req.query.redirect_uri) || getRedirectUri(req);
    console.log("Using REDIRECT_URI:", REDIRECT_URI);

    // Intercambia el código por tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    console.log(
      "Token response:",
      tokens.access_token ? "Token received" : "No token",
      tokens.error || ""
    );

    if (!tokens.access_token) {
      throw new Error(tokens.error_description || "No access token returned");
    }

    // Calcular expires_at (tiempo de expiración en milisegundos)
    const now = Date.now();
    const expires_at = tokens.expires_in
      ? now + tokens.expires_in * 1000
      : now + 3600 * 1000; // Default: 1 hora

    // Guarda los tokens en Firestore bajo el usuario con expires_at
    console.log("Saving tokens to Firestore for user:", uid);
    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          googleDriveTokens: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            // O-7: store lower-case canonical "bearer"
            token_type: (tokens.token_type || "bearer").toLowerCase(),
            expires_in: tokens.expires_in,
            expires_at: expires_at,
            scope: tokens.scope,
          },
        },
        { merge: true }
      );

    console.log("Google Drive tokens saved successfully with expiration!");

    // Redirigir de vuelta según el origen
    // Si viene de Electron, no redirigir (la app ya tiene el resultado)
    const isElectronRequest = req.get("referer")?.includes("localhost:8888");

    if (isElectronRequest) {
      // Responder con JSON para Electron
      return res.status(200).json({
        success: true,
        message: "Google Drive connected successfully",
      });
    }

    // T-3: env-driven base URL.
    const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
    const baseUrl = isEmulator
      ? "http://localhost:5173"
      : process.env.FIREBASE_APP_BASE_URL || "https://test-e4cf9.firebaseapp.com";
    const redirectUrl = `${baseUrl}/settings?status=success&service=google-drive`;

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("Error in googleDriveOAuthCallback:", error);

    // Verificar si viene de Electron
    const isElectronRequest = req.get("referer")?.includes("localhost:8888");

    if (isElectronRequest) {
      // Responder con JSON para Electron
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // T-3: env-driven base URL.
    const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
    const baseUrl = isEmulator
      ? "http://localhost:5173"
      : process.env.FIREBASE_APP_BASE_URL || "https://test-e4cf9.firebaseapp.com";
    const redirectUrl = `${baseUrl}/settings?status=error&service=google-drive&message=${encodeURIComponent(error.message)}`;

    return res.redirect(redirectUrl);
  }
});
