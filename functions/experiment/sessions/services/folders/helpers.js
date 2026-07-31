import { escapeDriveQueryValue } from "../../storage.js";

/**
 * F-2: validate that a user-supplied folder path is safe to interpolate into
 * remote API requests. Rejects path traversal, backslashes, leading slash
 * variants, control chars, and unbounded segment length.
 */
export function isSafeFolderPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) {
    return false;
  }
  if (/\\|[ -]|\0/.test(path)) return false;
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  for (const seg of segments) {
    if (seg === "." || seg === "..") return false;
    if (seg.length > 200) return false;
  }
  return true;
}

export function makeDriveFolderSearchQuery(folderName, parentId) {
  const parentForSearch = parentId ?? "root";
  return `name='${escapeDriveQueryValue(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${escapeDriveQueryValue(parentForSearch)}' in parents`;
}

export function splitFolderPath(folderPath) {
  return folderPath.split("/").filter((p) => p.length > 0);
}
