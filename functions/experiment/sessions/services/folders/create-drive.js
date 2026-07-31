import fetch from "../../../../utils/fetch-with-timeout.js";
import {
  makeDriveFolderSearchQuery,
  splitFolderPath,
} from "./helpers.js";

export async function createDriveFolder(token, folderPath) {
  const parts = splitFolderPath(folderPath);
  if (parts.length === 0) {
    return { success: false, errorText: "Invalid folder path" };
  }

  let currentParentId = null;
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
    if (searchResult.files && searchResult.files.length > 0) {
      currentParentId = searchResult.files[0].id;
      continue;
    }

    const metadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (currentParentId) {
      metadata.parents = [currentParentId];
    }

    const createResponse = await fetch(
      "https://www.googleapis.com/drive/v3/files",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metadata),
      },
    );

    const createResult = await createResponse.json();
    if (!createResponse.ok) {
      return {
        success: false,
        errorText: createResult.error?.message || "Error creating folder",
        errorCode: createResponse.status,
      };
    }
    currentParentId = createResult.id;
  }

  return {
    success: true,
    folderId: currentParentId,
    message: "Folder created successfully",
  };
}
