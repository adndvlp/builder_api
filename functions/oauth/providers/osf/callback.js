import { onRequest } from "firebase-functions/v2/https";
import fetch from "../../../utils/fetch-with-timeout.js";
import { db } from "../../../app.js";
import { validateOAuthState } from "../../state-service.js";
import { getClientRedirectUri } from "./config.js";
import { ensureExpBuilderProject } from "./project-init.js";
import { exchangeCodeForTokens } from "./token-exchange.js";

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
  // T-10: CORS headers handled by onRequest({cors:true}).
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
    // T-5: signed-state required. Rejects raw state=uid (legacy CSRF vector).
    const stateCheck = validateOAuthState(state, "osf");
    if (!stateCheck.ok) {
      return res.status(400).json({
        success: false,
        message: `Invalid OAuth state: ${stateCheck.reason}`,
      });
    }
    const uid = stateCheck.uid;

    console.log("OSF OAuth: Exchanging code for tokens, uid:", uid);

    const tokenResult = await exchangeCodeForTokens(code, redirect_uri);
    if (!tokenResult.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to exchange code for tokens",
        error: tokenResult.errorText,
      });
    }
    const tokenData = tokenResult.tokenData;

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

    const osfProjectId = await ensureExpBuilderProject(tokenData.access_token);

    // Guardar los tokens en Firestore. O-7: normalize token_type casing.
    const osfTokensData = {
      access_token: tokenData.access_token,
      token_type: (tokenData.token_type || "bearer").toLowerCase(),
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
