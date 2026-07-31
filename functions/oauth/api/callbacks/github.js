import { onRequest } from "firebase-functions/v2/https";
import fetch from "../../../utils/fetch-with-timeout.js";
import { db } from "../../../app.js";
import { validateRedirectUri } from "../../utils/redirect-allowlist.js";
import { validateOAuthState } from "../../state-service.js";

// Credenciales de GitHub (desde functions/.env)
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

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
    return "http://localhost:5173/github-callback";
  }
  // Producción web. T-3: derive from FIREBASE_APP_BASE_URL.
  const base =
    process.env.FIREBASE_APP_BASE_URL || "https://test-e4cf9.firebaseapp.com";
  return `${base}/github-callback`;
}

// Endpoint para el callback de OAuth
export const githubOAuthCallback = onRequest(async (req, res) => {
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
  const stateCheck = validateOAuthState(rawState, "github");
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
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code,
          redirect_uri: REDIRECT_URI,
        }),
      },
    );

    const tokens = await tokenRes.json();
    console.log(
      "Token response:",
      tokens.access_token ? "Token received" : "No token",
      tokens.error || "",
    );

    if (!tokens.access_token) {
      throw new Error(tokens.error_description || "No access token returned");
    }

    // Guarda los tokens en Firestore bajo el usuario
    console.log("Saving tokens to Firestore for user:", uid);
    await db.collection("users").doc(uid).set(
      {
        githubTokens: tokens,
      },
      { merge: true },
    );

    console.log("GitHub tokens saved successfully!");

    // Redirigir de vuelta según el origen
    // Si viene de Electron, no redirigir (la app ya tiene el resultado)
    const isElectronRequest = req.get("referer")?.includes("localhost:8888");

    if (isElectronRequest) {
      // Responder con JSON para Electron
      return res.status(200).json({
        success: true,
        message: "GitHub connected successfully",
      });
    }

    // T-3: env-driven base URL.
    const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
    const baseUrl = isEmulator
      ? "http://localhost:5173"
      : process.env.FIREBASE_APP_BASE_URL || "https://test-e4cf9.firebaseapp.com";
    const redirectUrl = `${baseUrl}/settings?status=success&service=github`;

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("Error in githubOAuthCallback:", error);

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
    const redirectUrl = `${baseUrl}/settings?status=error&service=github&message=${encodeURIComponent(error.message)}`;

    return res.redirect(redirectUrl);
  }
});
