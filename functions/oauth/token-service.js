import fetch from "../utils/fetch-with-timeout.js";
import { db } from "../app.js";
import { refreshOSFToken } from "./api/callbacks/osf.js";
import { refreshAccessToken } from "./refresh.js";
import { getTokenProvider } from "./token-registry.js";

function validTokenResult(accessToken, wasRefreshed = false) {
  return {
    success: true,
    access_token: accessToken,
    wasRefreshed,
  };
}

async function getValidOsfToken(userRef, userData) {
  const tokenProvider = getTokenProvider("osf");
  const tokensFieldName = tokenProvider.tokensFieldName;
  const tokensObject = userData[tokensFieldName];

  if (tokensObject && tokensObject.access_token) {
    const currentTime = Date.now();
    const expiresAt = tokensObject.expires_at || 0;

    if (expiresAt > currentTime + 5 * 60 * 1000) {
      console.log("Using existing valid OSF OAuth token");
      return validTokenResult(tokensObject.access_token);
    }

    if (tokensObject.refresh_token) {
      console.log("OSF OAuth token expired or about to expire, refreshing...");
      try {
        const refreshResult = await refreshOSFToken(tokensObject.refresh_token);
        const updatedTokens = {
          ...tokensObject,
          access_token: refreshResult.access_token,
          expires_at: refreshResult.expires_at,
        };

        await userRef.update({ [tokensFieldName]: updatedTokens });
        console.log("OSF OAuth token refreshed successfully");
        return validTokenResult(refreshResult.access_token, true);
      } catch (refreshError) {
        console.error("Failed to refresh OSF OAuth token:", refreshError);
      }
    }
  }

  if (userData.osfToken && userData.osfTokenValid) {
    try {
      const checkResp = await fetch("https://api.osf.io/v2/users/me/", {
        method: "GET",
        headers: { Authorization: `Bearer ${userData.osfToken}` },
      });
      if (checkResp.ok) {
        console.log("Using manual OSF token as fallback (validated)");
        return validTokenResult(userData.osfToken);
      }
      await userRef.update({ osfTokenValid: false });
      console.warn(
        "Manual OSF token rejected by API; marked invalid in Firestore",
      );
    } catch (checkError) {
      console.warn(
        "Could not validate manual OSF token (network error):",
        checkError.message,
      );
    }
  }

  console.error("User does not have valid OSF token (OAuth or manual)");
  return {
    success: false,
    error: "User has not connected OSF or token is invalid",
  };
}

async function getValidProviderToken(provider, userRef, userData) {
  const tokenProvider = getTokenProvider(provider);
  if (!tokenProvider?.tokensFieldName) {
    return {
      success: false,
      error: `Unknown provider: ${provider}`,
    };
  }
  const { tokensFieldName } = tokenProvider;
  const tokensObject = userData[tokensFieldName];

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
  if (expiresAt > currentTime + 5 * 60 * 1000) {
    console.log(`Using existing valid ${provider} token`);
    return validTokenResult(tokensObject.access_token);
  }

  console.log(`${provider} token expired or about to expire, refreshing...`);
  const refreshResult = await refreshAccessToken(
    provider,
    tokensObject.refresh_token,
  );

  if (!refreshResult.success) {
    return refreshResult;
  }

  const newExpiresAt = currentTime + refreshResult.expires_in * 1000;
  const updatedTokens = {
    ...tokensObject,
    access_token: refreshResult.access_token,
    expires_at: newExpiresAt,
    expires_in: refreshResult.expires_in,
  };

  await userRef.update({
    [tokensFieldName]: updatedTokens,
  });

  return validTokenResult(refreshResult.access_token, true);
}

export async function getValidToken(provider, uid) {
  try {
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
    if (provider === "osf") {
      return await getValidOsfToken(userRef, userData);
    }

    return await getValidProviderToken(provider, userRef, userData);
  } catch (error) {
    console.error(`Error in getValidToken for ${provider}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}
