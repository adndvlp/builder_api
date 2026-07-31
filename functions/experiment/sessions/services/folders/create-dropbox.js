import fetch from "../../../../utils/fetch-with-timeout.js";

export async function createDropboxFolder(token, folderPath) {
  const response = await fetch(
    "https://api.dropboxapi.com/2/files/create_folder_v2",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: folderPath,
        autorename: false,
      }),
    },
  );

  const result = await response.json();
  if (response.status === 200) {
    return { success: true, metadata: result.metadata };
  }

  if (
    response.status === 409 &&
    result.error?.[".tag"] === "path" &&
    result.error.path?.[".tag"] === "conflict"
  ) {
    return { success: true, alreadyExists: true };
  }

  return {
    success: false,
    errorCode: response.status,
    errorText: result.error_summary || response.statusText,
  };
}
