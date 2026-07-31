import { isSafeFolderPath } from "./helpers.js";
import { deleteDropboxFolder } from "./delete-dropbox.js";
import { deleteDriveFolder } from "./delete-drive.js";
import { deleteOsfFolder } from "./delete-osf.js";

export async function deleteFolder(provider, token, folderPath) {
  if (provider !== "osf" && !isSafeFolderPath(folderPath)) {
    return {
      success: false,
      errorCode: 400,
      errorText: "Invalid folderPath: contains unsafe characters or traversal",
    };
  }

  try {
    if (provider === "dropbox") {
      return await deleteDropboxFolder(token, folderPath);
    }
    if (provider === "googledrive") {
      return await deleteDriveFolder(token, folderPath);
    }
    if (provider === "osf") {
      return await deleteOsfFolder(token, folderPath);
    }
    return { success: false, errorText: "Unknown provider" };
  } catch (error) {
    return { success: false, errorText: error.message };
  }
}
