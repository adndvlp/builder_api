import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import fetch from "node-fetch";

// Inicializar Firebase Admin si no está inicializado
if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

// Configura tus credenciales de Google OAuth
const CLIENT_ID =
  "414213417080-bgjk8udcblfgrdld33eif0cmtofl7kir.apps.googleusercontent.com";
const CLIENT_SECRET = "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";

// Función para determinar el REDIRECT_URI correcto basado en el request
function getRedirectUri(req) {
  // Si viene de la app Electron (puerto 8888)
  if (req.get("referer")?.includes("localhost:8888")) {
    return "http://localhost:8888/callback";
  }
  // Si es desarrollo web
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:5173/google-drive-callback";
  }
  // Producción web
  return "https://test-e4cf9.firebaseapp.com/google-drive-callback";
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
  const uid = req.query.state; // Google usa "state" para pasar datos

  console.log(
    "Received callback with code:",
    code ? "present" : "missing",
    "uid:",
    uid
  );

  if (!code || !uid) {
    return res.status(400).send("Missing code or uid");
  }

  try {
    console.log("Exchanging code for tokens...");

    // Determinar el REDIRECT_URI correcto
    // Priorizar el redirect_uri que viene en el query param (desde el frontend)
    const REDIRECT_URI = req.query.redirect_uri || getRedirectUri(req);
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
            token_type: tokens.token_type,
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

    // Redirigir de vuelta a la app web con mensaje de éxito
    const redirectUrl =
      process.env.NODE_ENV === "production"
        ? "https://test-e4cf9.firebaseapp.com/settings?status=success&service=google-drive"
        : "http://localhost:5173/settings?status=success&service=google-drive";

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

    // Redirigir de vuelta a la app web con mensaje de error
    const redirectUrl =
      process.env.NODE_ENV === "production"
        ? `https://test-e4cf9.firebaseapp.com/settings?status=error&service=google-drive&message=${encodeURIComponent(
            error.message
          )}`
        : `http://localhost:5173/settings?status=error&service=google-drive&message=${encodeURIComponent(
            error.message
          )}`;

    return res.redirect(redirectUrl);
  }
});
