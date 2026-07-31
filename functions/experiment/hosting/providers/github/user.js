import fetch from "../../../../utils/fetch-with-timeout.js";

export async function getGithubUsername(accessToken) {
  try {
    const response = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const userData = await response.json();
    if (!response.ok) {
      return {
        success: false,
        errorText: userData.message || "Error getting GitHub username",
        errorCode: response.status,
      };
    }

    return {
      success: true,
      username: userData.login,
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}
