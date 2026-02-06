import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import fetch from "node-fetch";

// Inicializar Firebase Admin si no está inicializado
if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

/**
 * Obtiene el token de GitHub de un usuario
 * @param {string} uid - ID del usuario
 * @returns {Promise<Object>} - Objeto con el token de acceso o error
 */
export async function getGithubToken(uid) {
  try {
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return {
        success: false,
        error: "User not found",
      };
    }

    const userData = userDoc.data();
    const githubTokens = userData.githubTokens;

    if (!githubTokens || !githubTokens.access_token) {
      return {
        success: false,
        error: "No GitHub token found for user",
      };
    }

    return {
      success: true,
      access_token: githubTokens.access_token,
    };
  } catch (error) {
    console.error("Error getting GitHub token:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Configura tus credenciales de GitHub
const CLIENT_ID = "Ov23limim0vbyTd5J4fK";
const CLIENT_SECRET = "cdd3ae03ca594a2c16d8668b7698e816d8faebb0";

// Función para determinar el REDIRECT_URI correcto basado en el request
function getRedirectUri(req) {
  // Si viene de la app Electron (puerto 8888)
  if (req.get("referer")?.includes("localhost:8888")) {
    return "http://localhost:8888/callback";
  }
  // Si es desarrollo web
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:5173/github-callback";
  }
  // Producción web
  return "https://test-e4cf9.firebaseapp.com/github-callback";
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
  const uid = req.query.state; // GitHub usa "state" para pasar datos

  console.log(
    "Received callback with code:",
    code ? "present" : "missing",
    "uid:",
    uid,
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

    // Redirigir de vuelta a la app web con mensaje de éxito
    const redirectUrl =
      process.env.NODE_ENV === "production"
        ? "https://test-e4cf9.firebaseapp.com/settings?status=success&service=github"
        : "http://localhost:5173/settings?status=success&service=github";

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

    // Redirigir de vuelta a la app web con mensaje de error
    const redirectUrl =
      process.env.NODE_ENV === "production"
        ? `https://test-e4cf9.firebaseapp.com/settings?status=error&service=github&message=${encodeURIComponent(
            error.message,
          )}`
        : `http://localhost:5173/settings?status=error&service=github&message=${encodeURIComponent(
            error.message,
          )}`;

    return res.redirect(redirectUrl);
  }
});
