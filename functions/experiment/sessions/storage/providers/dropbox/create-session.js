import fetch from "../../../../../utils/fetch-with-timeout.js";

export async function createSession(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
  const initialCSV = "";
  const filePath = `${folderIdentifier}/${fileName}`;

  const checkResult = await fetch(
    "https://api.dropboxapi.com/2/files/get_metadata",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: filePath }),
    },
  );

  if (checkResult.status === 200) {
    return {
      success: false,
      error: "Session already exists",
      errorText: "Session already exists",
      errorCode: 409,
    };
  }

  const uploadResult = await fetch(
    "https://content.dropboxapi.com/2/files/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: filePath,
          mode: "add",
          autorename: false,
          mute: false,
        }),
        "Content-Type": "application/octet-stream",
      },
      body: initialCSV,
    },
  );

  if (uploadResult.status !== 200) {
    const result = await uploadResult.json().catch(() => ({}));
    return {
      success: false,
      errorCode: uploadResult.status,
      errorText: result.error_summary || uploadResult.statusText,
    };
  }

  const result = await uploadResult.json();
  return { success: true, id: result.id };
}
