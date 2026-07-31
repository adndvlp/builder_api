import fetch from "../../../../utils/fetch-with-timeout.js";
import {
  makeDriveFolderSearchQuery,
  splitFolderPath,
} from "./helpers.js";

export async function deleteDriveFolder(token, folderPath) {
  const parts = splitFolderPath(folderPath);
  if (parts.length === 0) {
    return { success: false, errorText: "Invalid folder path" };
  }

  let currentParentId = null;
  let targetFolderId = null;

  for (const folderName of parts) {
    const searchQuery = makeDriveFolderSearchQuery(
      folderName,
      currentParentId,
    );

    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        searchQuery,
      )}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const searchResult = await searchResponse.json();
    if (!searchResult.files || searchResult.files.length === 0) {
      return { success: true, message: "Folder does not exist" };
    }

    currentParentId = searchResult.files[0].id;
    targetFolderId = currentParentId;
  }

  const deleteResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${targetFolderId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!deleteResponse.ok) {
    const errorResult = await deleteResponse.json();
    return {
      success: false,
      errorText: errorResult.error?.message || "Error deleting folder",
      errorCode: deleteResponse.status,
    };
  }

  return { success: true, message: "Folder deleted successfully" };
}
