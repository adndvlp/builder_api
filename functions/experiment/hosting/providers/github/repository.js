import fetch from "../../../../utils/fetch-with-timeout.js";
import { getGithubUsername } from "./user.js";

export async function createRepositoryGithub(
  accessToken,
  repoName,
  isPrivate = false,
  description = "",
) {
  try {
    const usernameResult = await getGithubUsername(accessToken);
    if (!usernameResult.success) {
      return usernameResult;
    }

    const username = usernameResult.username;
    const checkResponse = await fetch(
      `https://api.github.com/repos/${username}/${repoName}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (checkResponse.ok) {
      return {
        success: true,
        repoUrl: `https://github.com/${username}/${repoName}`,
        repoName,
        owner: username,
        existed: true,
      };
    }

    const createResponse = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: repoName,
        description,
        private: isPrivate,
        auto_init: true,
      }),
    });

    const createResult = await createResponse.json();
    if (!createResponse.ok) {
      return {
        success: false,
        errorText: createResult.message || "Error creating repository",
        errorCode: createResponse.status,
      };
    }

    return {
      success: true,
      repoUrl: createResult.html_url,
      repoName: createResult.name,
      owner: createResult.owner.login,
      existed: false,
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}
