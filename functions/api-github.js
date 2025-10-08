import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import fetch from "node-fetch";

// Inicializar Firebase Admin si no está inicializado
if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

// Configura tus credenciales de GitHub
const CLIENT_ID = "Ov23limim0vbyTd5J4fK";
const CLIENT_SECRET = "cdd3ae03ca594a2c16d8668b7698e816d8faebb0";
const REDIRECT_URI = "http://localhost:3000/github-callback"; // Debe coincidir con el de GitHub Console
// const REDIRECT_URI = "https://test-e4cf9.firebaseapp.com/github-callback"; // Para producción

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
    uid
  );

  if (!code || !uid) {
    return res.status(400).send("Missing code or uid");
  }

  try {
    console.log("Exchanging code for tokens...");
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
      }
    );

    const tokens = await tokenRes.json();
    console.log(
      "Token response:",
      tokens.access_token ? "Token received" : "No token",
      tokens.error || ""
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
      { merge: true }
    );

    console.log("GitHub tokens saved successfully!");
    return res.status(200).send("GitHub tokens saved!");
  } catch (error) {
    console.error("Error in githubOAuthCallback:", error);
    return res
      .status(500)
      .send(`Error exchanging code for tokens: ${error.message}`);
  }
});
