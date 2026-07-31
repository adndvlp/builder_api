import fetch from "../../../../../utils/fetch-with-timeout.js";
import { searchDriveFileByName } from "../../helpers.js";

export async function deleteSession(
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
  const deleteResult = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!deleteResult.ok) {
    const errorResult = await deleteResult.json();
    return {
      success: false,
      errorText: errorResult.error?.message || "Error deleting session",
      errorCode: deleteResult.status,
    };
  }

  return { success: true, message: "Session deleted successfully" };
}
