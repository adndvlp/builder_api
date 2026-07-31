import fetch from "../../../utils/fetch-with-timeout.js";
import { CLIENT_ID, CLIENT_SECRET } from "./config.js";

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
      token_type: (tokenData.token_type || "bearer").toLowerCase(),
      expires_at: expiresAt,
    };
  } catch (error) {
    console.error("Error refreshing OSF token:", error);
    throw error;
  }
}
