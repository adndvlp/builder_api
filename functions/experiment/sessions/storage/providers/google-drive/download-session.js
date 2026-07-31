import fetch from "../../../../../utils/fetch-with-timeout.js";
import { searchDriveFileByName } from "../../helpers.js";

export async function downloadSession(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  const searchResult = await searchDriveFileByName(
    token,
    folderIdentifier,
    fileName,
  );

  const searchData = await searchResult.json();
  if (!searchData.files || searchData.files.length === 0) {
    return {
      success: false,
      errorText: "Session not found",
      errorCode: 404,
    };
  }

  const fileId = searchData.files[0].id;
  const downloadResult = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!downloadResult.ok) {
    return {
      success: false,
      errorText: "Error downloading file",
      errorCode: downloadResult.status,
    };
  }

  const csv = await downloadResult.text();
  return { success: true, csv };
}
