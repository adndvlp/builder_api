import MESSAGES from "../../api/messages.js";

/**
 * list/download/deleteSession en storage.js esperan componentId para OSF.
 * Devolver osfComponentId si está; sino extraerlo de osfUploadLink
 * (formato https://files.osf.io/v1/resources/{componentId}/providers/osfstorage/).
 */
function resolveOsfComponentId(exp_data) {
  if (exp_data.osfComponentId) return exp_data.osfComponentId;
  const link = exp_data.osfUploadLink || "";
  const match = link.match(/\/resources\/([^/]+)\//);
  return match ? match[1] : null;
}

/**
 * T-13 / S-15: resolve the per-provider folder identifier for list/download/
 * delete operations. Drive uses folderId, Dropbox uses folderPath, OSF uses
 * componentId. Previously the switch was inlined in 6+ places with the OSF
 * branch using inconsistent fallbacks (uploadLink vs componentId — T-14).
 */
export function getSessionFolderIdentifier(exp_data) {
  const provider = exp_data.storageProvider || "googledrive";
  if (provider === "googledrive") return exp_data.driveFolderId;
  if (provider === "dropbox") return exp_data.dropboxFolder;
  if (provider === "osf") return resolveOsfComponentId(exp_data);
  return null;
}

export function getInvalidTokenMessage(storageProvider) {
  if (storageProvider === "dropbox") {
    return MESSAGES.INVALID_DROPBOX_TOKEN;
  }
  if (storageProvider === "osf") {
    return MESSAGES.INVALID_OSF_TOKEN;
  }
  return MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN;
}
