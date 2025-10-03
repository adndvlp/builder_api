const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { google } = require("googleapis");

if (!admin.apps.length) {
  admin.initializeApp();
}

// Configura tus credenciales de Google
const CLIENT_ID =
  "414213417080-bgjk8udcblfgrdld33eif0cmtofl7kir.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const REDIRECT_URI = "https://test-e4cf9.firebaseapp.com/__/auth/handler"; // Debe coincidir con el de Google Console

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Endpoint para el callback de OAuth
exports.driveOAuthCallback = functions.https.onRequest(async (req, res) => {
  const code = req.query.code;
  const uid = req.query.uid; // Debes pasar el UID del usuario autenticado
  if (!code || !uid) {
    return res.status(400).send("Missing code or uid");
  }
  try {
    // Intercambia el código por tokens
    const { tokens } = await oauth2Client.getToken(code);
    // Guarda los tokens en Firestore bajo el usuario
    await admin.firestore().collection("users").doc(uid).set(
      {
        driveTokens: tokens,
        driveTokenValid: true,
      },
      { merge: true }
    );
    return res.status(200).send("Google Drive tokens saved!");
  } catch (error) {
    console.error(error);
    return res.status(500).send("Error exchanging code for tokens");
  }
});
