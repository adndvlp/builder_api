import fetch from "../../../../utils/fetch-with-timeout.js";

const GH_CONTENTS_API_LIMIT = 1024 * 1024;

export async function uploadFileGithub(
  accessToken,
  owner,
  repoName,
  filePath,
  content,
  message = "Add file via API",
  branch = "main",
) {
  try {
    const contentBase64 = Buffer.from(content).toString("base64");
    const rawBytes = Buffer.byteLength(
      typeof content === "string" ? content : content,
    );

    if (rawBytes > GH_CONTENTS_API_LIMIT) {
      return {
        success: false,
        errorCode: 413,
        errorText: `File ${filePath} is ${rawBytes} bytes — GitHub Contents API limit is ${GH_CONTENTS_API_LIMIT} bytes. Use Git Data API for larger files.`,
      };
    }

    const checkResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}?ref=${branch}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    let sha = null;
    if (checkResponse.ok) {
      const fileData = await checkResponse.json();
      sha = fileData.sha;
    }

    const uploadResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          content: contentBase64,
          branch,
          ...(sha && { sha }),
        }),
      },
    );

    const uploadResult = await uploadResponse.json();
    if (!uploadResponse.ok) {
      return {
        success: false,
        errorText: uploadResult.message || "Error uploading file",
        errorCode: uploadResponse.status,
      };
    }

    return {
      success: true,
      filePath,
      fileUrl: uploadResult.content.html_url,
      commit: uploadResult.commit.sha,
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}
