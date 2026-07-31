import fetch from "../../../../utils/fetch-with-timeout.js";

export async function deleteDropboxFolder(token, folderPath) {
  const response = await fetch(
    "https://api.dropboxapi.com/2/files/delete_v2",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: folderPath }),
    },
  );

  const result = await response.json();
  if (response.status === 200) {
    return { success: true, metadata: result.metadata };
  }

  return {
    success: false,
    errorCode: response.status,
    errorText: result.error_summary || response.statusText,
  };
}
