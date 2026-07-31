import fetch from "../../../../utils/fetch-with-timeout.js";

export async function enableGithubPages(
  accessToken,
  owner,
  repoName,
  branch = "main",
  path = "/",
  pollOptions = {},
) {
  try {
    const checkResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pages`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (checkResponse.ok) {
      const pagesData = await checkResponse.json();
      return {
        success: true,
        pagesUrl: pagesData.html_url,
        existed: true,
      };
    }

    const enableResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: {
            branch,
            path,
          },
        }),
      },
    );

    const enableResult = await enableResponse.json();
    const isAlreadyEnabled =
      enableResponse.status === 422 &&
      /already|pages site/i.test(enableResult.message || "");

    if (!enableResponse.ok && enableResponse.status !== 201 && !isAlreadyEnabled) {
      return {
        success: false,
        errorText: enableResult.message || "Error enabling GitHub Pages",
        errorCode: enableResponse.status,
      };
    }

    const maxAttempts = pollOptions.maxAttempts ?? 60;
    const pollIntervalMs = pollOptions.pollIntervalMs ?? 500;

    for (let i = 0; i < maxAttempts; i++) {
      const pagesResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/pages`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );

      if (pagesResponse.ok) {
        const pagesData = await pagesResponse.json();
        if (pagesData?.html_url) {
          return {
            success: true,
            pagesUrl: pagesData.html_url,
            existed: false,
          };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return {
      success: true,
      pagesUrl: `https://${owner}.github.io/${repoName}/`,
      existed: false,
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}
