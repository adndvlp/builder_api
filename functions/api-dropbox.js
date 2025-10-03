import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import fetch from "node-fetch";

// Inicializar Firebase Admin si no está inicializado
if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

// Configura tus credenciales de Dropbox
const CLIENT_ID = "pn9j0lbuvbmu3wl";
const CLIENT_SECRET = "hwbrvahrl8r3ssk";
// const REDIRECT_URI = "https://test-e4cf9.firebaseapp.com/dropbox-callback"; // Debe coincidir con el de Dropbox Console
const REDIRECT_URI = "http://localhost:3000/dropbox-callback"; // Debe coincidir con el de Dropbox Console

// Endpoint para el callback de OAuth
export const dropboxOAuthCallback = onRequest(async (req, res) => {
  // Permitir CORS para desarrollo local
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const code = req.query.code;
  const uid = req.query.state; // Dropbox usa "state" para pasar datos

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
    const tokenRes = await fetch("https://api.dropbox.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
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

    // Guarda los tokens en Firestore bajo el usuario
    console.log("Saving tokens to Firestore for user:", uid);
    await db.collection("users").doc(uid).set(
      {
        dropboxTokens: tokens,
      },
      { merge: true }
    );

    console.log("Dropbox tokens saved successfully!");
    return res.status(200).send("Dropbox tokens saved!");
  } catch (error) {
    console.error("Error in dropboxOAuthCallback:", error);
    return res
      .status(500)
      .send(`Error exchanging code for tokens: ${error.message}`);
  }
});
