import fetch from "node-fetch";
import { db } from "./app.js";

// Configuración de Dropbox
const CLIENT_ID = "pn9j0lbuvbmu3wl";
const CLIENT_SECRET = "hwbrvahrl8r3ssk";

/**
 * Refresca el access token de Dropbox usando el refresh token
 * @param {string} refreshToken - El refresh token de Dropbox
 * @returns {Promise<Object>} - Objeto con los nuevos tokens o error
 */
async function refreshDropboxToken(refreshToken) {
  try {
    console.log("Refreshing Dropbox token...");

    const tokenRes = await fetch("https://api.dropbox.com/oauth2/token", {
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
      expires_in: tokens.expires_in, // Típicamente 14400 segundos (4 horas)
    };
  } catch (error) {
    console.error("Error refreshing Dropbox token:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Obtiene un token válido de Dropbox para un usuario
 * Si el token está expirado, lo refresca automáticamente
 * @param {string} uid - El ID del usuario en Firebase
 * @returns {Promise<Object>} - Objeto con el token válido o error
 */
export async function getValidDropboxToken(uid) {
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
    if (!userData.dropboxTokens) {
      return {
        success: false,
        error: "NO_DROPBOX_TOKENS",
        message: "User has not connected Dropbox",
      };
    }

    const { access_token, refresh_token, expires_at } = userData.dropboxTokens;

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
        message: "No refresh token available. User needs to reconnect Dropbox",
      };
    }

    // Refrescar el token
    const refreshResult = await refreshDropboxToken(refresh_token);

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
      dropboxTokens: updatedTokens,
    });

    console.log("New token saved to Firestore");

    return {
      success: true,
      access_token: refreshResult.access_token,
    };
  } catch (error) {
    console.error("Error in getValidDropboxToken:", error);
    return {
      success: false,
      error: "INTERNAL_ERROR",
      message: error.message,
    };
  }
}

export default getValidDropboxToken;
