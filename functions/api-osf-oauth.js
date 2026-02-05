import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import fetch from "node-fetch";

// Inicializar Firebase Admin si no está inicializado
if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

// OSF OAuth credentials
const CLIENT_ID = "ee4514d3235d4acb8da4443b3516ede2";
const CLIENT_SECRET = "jBAj5jjv5fNCfzkfWPYBbsM7gWlmur0rBy3gAu3K";

/**
 * Determina la URI de redirección según el entorno
 * @param {string} [explicitUri] - URI de redirección explícita (para Electron)
 * @returns {string} La URI de redirección apropiada
 */
function getRedirectUri(explicitUri) {
  // Si se proporciona explícitamente (desde Electron), usarlo
  if (explicitUri) {
    return explicitUri;
  }

  const isProduction = process.env.FUNCTIONS_EMULATOR !== "true";

  if (isProduction) {
    return "https://us-central1-builder-f43c3.cloudfunctions.net/osfOAuthCallback";
  } else {
    return "http://localhost:5173/oauth/osf/callback";
  }
}

/**
 * Callback de OAuth de OSF
 *
 * Flujo:
 * 1. Usuario es redirigido a accounts.osf.io/oauth2/authorize
 * 2. Después de autorizar, OSF redirige aquí con el código
 * 3. Intercambiamos el código por tokens de acceso y refresh
 * 4. Guardamos los tokens en Firestore
 * 5. Redirigimos al usuario de vuelta a la aplicación
 */
export const osfOAuthCallback = onRequest({ cors: true }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const { code, state, error, redirect_uri } = req.query;

  // Si el usuario denegó el acceso
  if (error === "access_denied") {
    console.error("OSF OAuth: User denied access");
    return res.redirect(
      `${getClientRedirectUri()}?error=access_denied&provider=osf`,
    );
  }

  // Validar que tenemos el código de autorización
  if (!code) {
    console.error("OSF OAuth: Missing authorization code");
    return res.status(400).json({
      success: false,
      message: "Missing authorization code",
    });
  }

  // Validar el state para prevenir CSRF
  if (!state) {
    console.error("OSF OAuth: Missing state parameter");
    return res.status(400).json({
      success: false,
      message: "Missing state parameter",
    });
  }

  try {
    // Extraer el UID del state
    const uid = state; // El state contiene el UID del usuario

    console.log("OSF OAuth: Exchanging code for tokens, uid:", uid);

    // Intercambiar el código por tokens
    const tokenResponse = await fetch("https://accounts.osf.io/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code: code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: getRedirectUri(redirect_uri),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("OSF OAuth: Token exchange failed:", errorText);
      return res.status(400).json({
        success: false,
        message: "Failed to exchange code for tokens",
        error: errorText,
      });
    }

    const tokenData = await tokenResponse.json();
    console.log("OSF OAuth: Token exchange successful");

    // Calcular la fecha de expiración
    const expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;

    // Obtener información del usuario de OSF usando el access token
    const profileResponse = await fetch("https://api.osf.io/v2/users/me/", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
    });

    let osfUserId = null;
    let osfUserName = null;

    if (profileResponse.ok) {
      const profileData = await profileResponse.json();
      osfUserId = profileData.data.id;
      osfUserName = profileData.data.attributes.full_name;
      console.log("OSF OAuth: User profile retrieved:", osfUserId, osfUserName);
    }

    // Crear proyecto "ExpBuilder" automáticamente si no existe
    let osfProjectId = null;
    try {
      console.log("OSF OAuth: Creating ExpBuilder project...");
      const projectResponse = await fetch(
        "https://api.osf.io/v2/nodes/?region=us",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenData.access_token}`,
          },
          body: JSON.stringify({
            data: {
              type: "nodes",
              attributes: {
                title: "ExpBuilder",
                category: "project",
                description: "Experiment Builder data storage",
                public: false,
              },
            },
          }),
        },
      );

      if (projectResponse.ok) {
        const projectData = await projectResponse.json();
        osfProjectId = projectData.data.id;
        console.log("OSF OAuth: ExpBuilder project created:", osfProjectId);
      } else {
        const errorData = await projectResponse.json();
        console.warn(
          "OSF OAuth: Could not create project:",
          errorData.errors?.[0]?.detail,
        );
      }
    } catch (projectError) {
      console.warn("OSF OAuth: Error creating project:", projectError.message);
    }

    // Guardar los tokens en Firestore
    const osfTokensData = {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      expires_at: expiresAt,
      scope: tokenData.scope || "osf.full_read osf.full_write",
    };

    // Si recibimos refresh token (offline mode), guardarlo también
    if (tokenData.refresh_token) {
      osfTokensData.refresh_token = tokenData.refresh_token;
    }

    const userUpdateData = {
      osfTokens: osfTokensData,
      osfUserId: osfUserId,
      osfUserName: osfUserName,
      osfTokenValid: true,
    };

    // Agregar projectId si se creó exitosamente
    if (osfProjectId) {
      userUpdateData.osfProjectId = osfProjectId;
    }

    await db.collection("users").doc(uid).set(userUpdateData, { merge: true });

    console.log("OSF OAuth: Tokens saved successfully for user:", uid);

    // Redirigir al usuario de vuelta a la aplicación
    return res.redirect(`${getClientRedirectUri()}?success=true&provider=osf`);
  } catch (error) {
    console.error("OSF OAuth callback error:", error);
    return res.redirect(
      `${getClientRedirectUri()}?error=token_exchange_failed&provider=osf`,
    );
  }
});

/**
 * Obtiene la URI de redirección del cliente
 * @returns {string} La URI del cliente
 */
function getClientRedirectUri() {
  const isProduction = process.env.FUNCTIONS_EMULATOR !== "true";
  const isElectron = false; // TODO: Detect electron environment if needed

  if (isElectron) {
    return "http://localhost:8888/settings";
  } else if (isProduction) {
    return "https://builder-f43c3.firebaseapp.com/settings";
  } else {
    return "http://localhost:5173/settings";
  }
}

/**
 * Función para refrescar el access token de OSF usando el refresh token
 * Esta función puede ser llamada desde otros módulos
 */
export async function refreshOSFToken(refreshToken) {
  try {
    console.log("OSF OAuth: Refreshing access token");

    const tokenResponse = await fetch("https://accounts.osf.io/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("OSF OAuth: Token refresh failed:", errorText);
      throw new Error("Failed to refresh OSF token");
    }

    const tokenData = await tokenResponse.json();
    console.log("OSF OAuth: Token refreshed successfully");

    // Calcular la nueva fecha de expiración
    const expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;

    return {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      expires_at: expiresAt,
    };
  } catch (error) {
    console.error("Error refreshing OSF token:", error);
    throw error;
  }
}

/**
 * Función helper para iniciar el flujo de OAuth de OSF
 * Esta función genera la URL de autorización
 */
export function getOSFAuthorizationUrl(uid) {
  const authUrl = new URL("https://accounts.osf.io/oauth2/authorize");
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("client_id", CLIENT_ID);
  authUrl.searchParams.append("redirect_uri", getRedirectUri());
  authUrl.searchParams.append("scope", "osf.full_read osf.full_write");
  authUrl.searchParams.append("access_type", "offline"); // Para obtener refresh token
  authUrl.searchParams.append("approval_prompt", "auto");
  authUrl.searchParams.append("state", uid); // Usar el UID como state para CSRF protection

  return authUrl.toString();
}
