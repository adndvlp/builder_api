import fetch from "../../../utils/fetch-with-timeout.js";
import { validateRedirectUri } from "../../utils/redirect-allowlist.js";
import { CLIENT_ID, CLIENT_SECRET, getRedirectUri } from "./config.js";

export async function exchangeCodeForTokens(code, redirectUri) {
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
      // T-4: only honor caller-supplied redirect_uri after allowlist check.
      redirect_uri: getRedirectUri(validateRedirectUri(redirectUri)),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("OSF OAuth: Token exchange failed:", errorText);
    return { success: false, errorText };
  }

  const tokenData = await tokenResponse.json();
  console.log("OSF OAuth: Token exchange successful");

  return { success: true, tokenData };
}
