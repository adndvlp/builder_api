import fetch from "../utils/fetch-with-timeout.js";
import { getTokenProvider } from "./token-registry.js";

export async function refreshAccessToken(provider, refreshToken) {
  try {
    const tokenProvider = getTokenProvider(provider);
    if (!tokenProvider?.config) {
      return {
        success: false,
        error: `Unknown provider: ${provider}`,
      };
    }
    const { config } = tokenProvider;

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
        tokens.error_description,
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
