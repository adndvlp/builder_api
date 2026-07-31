import { db } from "../app.js";
import { getTokenProvider } from "./token-registry.js";

export async function saveTokens(
  provider,
  uid,
  accessToken,
  refreshToken,
  expiresIn,
) {
  try {
    const userRef = db.collection("users").doc(uid);
    const expiresAt = Date.now() + expiresIn * 1000;
    const tokenProvider = getTokenProvider(provider);
    if (!tokenProvider?.tokensFieldName) {
      return { success: false, error: `Unknown provider: ${provider}` };
    }
    const { tokensFieldName } = tokenProvider;

    await userRef.set(
      {
        [tokensFieldName]: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          expires_in: expiresIn,
          token_type: "bearer",
        },
      },
      { merge: true },
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
