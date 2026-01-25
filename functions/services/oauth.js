import fetch from "node-fetch";
import { db } from "../app.js";

// Configuración de proveedores OAuth
const OAUTH_CONFIGS = {
  dropbox: {
    clientId: "pn9j0lbuvbmu3wl",
    clientSecret: "hwbrvahrl8r3ssk",
    tokenUrl: "https://api.dropbox.com/oauth2/token",
  },
  googledrive: {
    clientId:
      "414213417080-bgjk8udcblfgrdld33eif0cmtofl7kir.apps.googleusercontent.com",
    clientSecret: "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",
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
};

/**
 * Refresca el access token usando el refresh token
 * @param {string} provider - El proveedor ('dropbox' o 'googledrive')
 * @param {string} refreshToken - El refresh token
 * @returns {Promise<Object>} - Objeto con los nuevos tokens o error
 */
async function refreshAccessToken(provider, refreshToken) {
  try {
    const config = OAUTH_CONFIGS[provider];
    if (!config) {
      return {
        success: false,
        error: `Unknown provider: ${provider}`,
      };
    }

    console.log(`Refreshing ${provider} token...`);

    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.access_token) {
      console.error(
        `Failed to refresh ${provider} token:`,
        tokens.error_description
      );
      return {
        success: false,
        error: tokens.error_description || "No access token returned",
      };
    }

    console.log(`${provider} token refreshed successfully`);
    return {
      success: true,
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
    };
  } catch (error) {
    console.error(`Error refreshing ${provider} token:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Obtiene un token válido (refresca si es necesario)
 * @param {string} provider - El proveedor ('dropbox' o 'googledrive')
 * @param {string} uid - ID del usuario
 * @returns {Promise<Object>} - Objeto con el token válido o error
 */
export async function getValidToken(provider, uid) {
  try {
    // Para OSF, solo necesitamos recuperar el token (no hay OAuth/refresh)
    if (provider === "osf") {
      const userRef = db.collection("users").doc(uid);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        console.error("User not found:", uid);
        return {
          success: false,
          error: "User not found",
        };
      }

      const userData = userDoc.data();

      if (!userData.osfToken || !userData.osfTokenValid) {
        console.error("User does not have valid OSF token");
        return {
          success: false,
          error: "User has not connected OSF or token is invalid",
        };
      }

      return {
        success: true,
        access_token: userData.osfToken,
        wasRefreshed: false,
      };
    }

    // Obtener datos del usuario desde Firestore
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.error("User not found:", uid);
      return {
        success: false,
        error: "User not found",
      };
    }

    const userData = userDoc.data();

    // Mapeo de nombres de campos según el proveedor
    const tokensFieldName =
      provider === "dropbox" ? "dropboxTokens" : "googleDriveTokens";
    const tokensObject = userData[tokensFieldName];

    // Verificar si el usuario tiene tokens
    if (
      !tokensObject ||
      !tokensObject.access_token ||
      !tokensObject.refresh_token
    ) {
      console.error(`User does not have ${provider} tokens`);
      return {
        success: false,
        error: `User has not connected ${provider}`,
      };
    }

    const currentTime = Date.now();
    const expiresAt = tokensObject.expires_at || 0;

    // Si el token aún es válido (con margen de 5 minutos), devolverlo
    if (expiresAt > currentTime + 5 * 60 * 1000) {
      console.log(`Using existing valid ${provider} token`);
      return {
        success: true,
        access_token: tokensObject.access_token,
        wasRefreshed: false,
      };
    }

    // El token expiró o está por expirar, refrescarlo
    console.log(`${provider} token expired or about to expire, refreshing...`);
    const refreshResult = await refreshAccessToken(
      provider,
      tokensObject.refresh_token
    );

    if (!refreshResult.success) {
      return refreshResult;
    }

    // Calcular nueva fecha de expiración
    const newExpiresAt = currentTime + refreshResult.expires_in * 1000;

    // Actualizar el objeto completo de tokens manteniendo los otros campos
    const updatedTokens = {
      ...tokensObject,
      access_token: refreshResult.access_token,
      expires_at: newExpiresAt,
      expires_in: refreshResult.expires_in,
    };

    // Guardar el nuevo token en Firestore
    await userRef.update({
      [tokensFieldName]: updatedTokens,
    });

    return {
      success: true,
      access_token: refreshResult.access_token,
      wasRefreshed: true,
    };
  } catch (error) {
    console.error(`Error in getValid${provider}Token:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Guarda tokens de OAuth para un usuario
 * @param {string} provider - El proveedor ('dropbox' o 'googledrive')
 * @param {string} uid - ID del usuario
 * @param {string} accessToken - Access token
 * @param {string} refreshToken - Refresh token
 * @param {number} expiresIn - Tiempo de expiración en segundos
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function saveTokens(
  provider,
  uid,
  accessToken,
  refreshToken,
  expiresIn
) {
  try {
    const userRef = db.collection("users").doc(uid);
    const expiresAt = Date.now() + expiresIn * 1000;

    const tokensFieldName =
      provider === "dropbox" ? "dropboxTokens" : "googleDriveTokens";

    await userRef.set(
      {
        [tokensFieldName]: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          expires_in: expiresIn,
          token_type: provider === "googledrive" ? "Bearer" : "bearer",
        },
      },
      { merge: true }
    );

    console.log(`${provider} tokens saved successfully for user:`, uid);
    return {
      success: true,
      message: "Tokens saved successfully",
    };
  } catch (error) {
    console.error(`Error saving ${provider} tokens:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Funciones de compatibilidad para código existente
export default function getValidDropboxToken(uid) {
  return getValidToken("dropbox", uid);
}

export function getValidGoogleDriveToken(uid) {
  return getValidToken("googledrive", uid);
}
