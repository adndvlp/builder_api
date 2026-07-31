import { isSafeFolderPath } from "./helpers.js";
import { createDropboxFolder } from "./create-dropbox.js";
import { createDriveFolder } from "./create-drive.js";
import { createOsfFolder } from "./create-osf.js";

export async function createFolder(
  provider,
  token,
  folderPath,
  componentName = "Data",
) {
  if (provider !== "osf" && !isSafeFolderPath(folderPath)) {
    return {
      success: false,
      errorCode: 400,
      errorText: "Invalid folderPath: contains unsafe characters or traversal",
    };
  }

  try {
    if (provider === "dropbox") {
      return await createDropboxFolder(token, folderPath);
    }
    if (provider === "googledrive") {
      return await createDriveFolder(token, folderPath);
    }
    if (provider === "osf") {
      return await createOsfFolder(token, folderPath, componentName);
    }
    return { success: false, errorText: "Unknown provider" };
  } catch (error) {
    return { success: false, errorText: error.message };
  }
}
