import fetch from "../../../../../utils/fetch-with-timeout.js";

export async function deleteSession(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
  const filePath = `${folderIdentifier}/${fileName}`;

  const deleteResult = await fetch(
    "https://api.dropboxapi.com/2/files/delete_v2",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: filePath }),
    },
  );

  if (deleteResult.status !== 200) {
    const result = await deleteResult.json().catch(() => ({}));
    return {
      success: false,
      errorCode: deleteResult.status,
      errorText: result.error_summary || deleteResult.statusText,
    };
  }

  return { success: true };
}
