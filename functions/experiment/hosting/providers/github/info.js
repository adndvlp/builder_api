import fetch from "../../../../utils/fetch-with-timeout.js";

export async function getRepositoryInfo(accessToken, owner, repoName) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    const repoData = await response.json();
    if (!response.ok) {
      return {
        success: false,
        errorText: repoData.message || "Error getting repository info",
        errorCode: response.status,
      };
    }

    return {
      success: true,
      repo: {
        name: repoData.name,
        fullName: repoData.full_name,
        description: repoData.description,
        url: repoData.html_url,
        private: repoData.private,
        createdAt: repoData.created_at,
        updatedAt: repoData.updated_at,
      },
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}
