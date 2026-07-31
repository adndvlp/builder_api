import fetch from "../../../../../utils/fetch-with-timeout.js";

export async function downloadSession(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
  const filePath = `${folderIdentifier}/${fileName}`;

  const downloadResult = await fetch(
    "https://content.dropboxapi.com/2/files/download",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
      },
    },
  );

  if (downloadResult.status !== 200) {
    return { success: false, error: "Session not found" };
  }

  const csv = await downloadResult.text();
  return { success: true, csv, filename: fileName };
}
