import fetch from "node-fetch";
import { db } from "./app.js";

// Configuración de Google OAuth
const CLIENT_ID =
  "414213417080-bgjk8udcblfgrdld33eif0cmtofl7kir.apps.googleusercontent.com";
const CLIENT_SECRET = "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";

/**
 * Refresca el access token de Google Drive usando el refresh token
 * @param {string} refreshToken - El refresh token de Google
 * @returns {Promise<Object>} - Objeto con los nuevos tokens o error
 */
async function refreshGoogleDriveToken(refreshToken) {
  try {
    console.log("Refreshing Google Drive token...");

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.access_token) {
      console.error("Failed to refresh token:", tokens.error_description);
      return {
        success: false,
        error: tokens.error_description || "No access token returned",
      };
    }

    console.log("Token refreshed successfully");
    return {
      success: true,
      access_token: tokens.access_token,
      expires_in: tokens.expires_in, // Típicamente 3600 segundos (1 hora)
    };
  } catch (error) {
    console.error("Error refreshing Google Drive token:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Obtiene un token válido de Google Drive para un usuario
 * Si el token está expirado, lo refresca automáticamente
 * @param {string} uid - El ID del usuario en Firebase
 * @returns {Promise<Object>} - Objeto con el token válido o error
 */
export async function getValidGoogleDriveToken(uid) {
  try {
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return {
        success: false,
        error: "USER_NOT_FOUND",
        message: "User not found",
      };
    }

    const userData = userDoc.data();

    // Verificar que existan los tokens
    if (!userData.googleDriveTokens) {
      return {
        success: false,
        error: "NO_GOOGLE_DRIVE_TOKENS",
        message: "User has not connected Google Drive",
      };
    }

    const { access_token, refresh_token, expires_at } =
      userData.googleDriveTokens;

    // Si no hay access_token
    if (!access_token) {
      return {
        success: false,
        error: "NO_ACCESS_TOKEN",
        message: "No access token available",
      };
    }

    // Verificar si el token está expirado
    const now = Date.now();
    const isExpired = expires_at && now >= expires_at;

    // Si el token no está expirado, retornarlo
    if (!isExpired && expires_at) {
      console.log("Using existing valid token");
      return {
        success: true,
        access_token,
      };
    }

    // Si está expirado o no tiene expires_at, intentar refrescar
    console.log("Token expired or no expiration info, refreshing...");

    if (!refresh_token) {
      return {
        success: false,
        error: "NO_REFRESH_TOKEN",
        message:
          "No refresh token available. User needs to reconnect Google Drive",
      };
    }

    // Refrescar el token
    const refreshResult = await refreshGoogleDriveToken(refresh_token);

    if (!refreshResult.success) {
      return {
        success: false,
        error: "REFRESH_FAILED",
        message: `Failed to refresh token: ${refreshResult.error}`,
      };
    }

    // Calcular nuevo expires_at
    const new_expires_at = now + refreshResult.expires_in * 1000;

    // Guardar el nuevo token en Firestore
    const updatedTokens = {
      access_token: refreshResult.access_token,
      refresh_token, // Mantener el mismo refresh_token
      expires_at: new_expires_at,
      expires_in: refreshResult.expires_in,
    };

    await db.collection("users").doc(uid).update({
      googleDriveTokens: updatedTokens,
    });

    console.log("New token saved to Firestore");

    return {
      success: true,
      access_token: refreshResult.access_token,
    };
  } catch (error) {
    console.error("Error in getValidGoogleDriveToken:", error);
    return {
      success: false,
      error: "INTERNAL_ERROR",
      message: error.message,
    };
  }
}

export default getValidGoogleDriveToken;
