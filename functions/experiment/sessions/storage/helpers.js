import fetch from "../../../utils/fetch-with-timeout.js";

/**
 * Escapa valores que se interpolan dentro de Drive search queries (q=...).
 * Drive usa "\" como escape; backslashes y comillas simples DEBEN ir escapados
 * o un nombre/ID con un apóstrofo rompe la query (o lista archivos ajenos).
 * Spec: https://developers.google.com/drive/api/guides/search-files#query_string
 */
export function escapeDriveQueryValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

/**
 * Build a strict matcher for session filenames belonging to a single experiment.
 * Filename contract: `${experimentID}_${sessionId}.csv` where `sessionId` MUST
 * NOT contain `_`. This rules out collisions like experimentID "foo" matching
 * files of "foo_bar_*" (St-5).
 */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function makeSessionFileMatcher(experimentID) {
  return new RegExp(`^${escapeRegex(experimentID)}_[^_]+\\.csv$`);
}
export function extractSessionId(name, experimentID) {
  return name.slice(experimentID.length + 1, -".csv".length);
}

/**
 * St-6: best-effort MIME lookup from file extension. Falls back to
 * application/octet-stream — never JSON, since the hard-coded JSON guess
 * mis-tagged CSVs and breaks the Drive UI preview.
 */
const MIME_BY_EXT = {
  csv: "text/csv",
  json: "application/json",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  pdf: "application/pdf",
};
export function mimeFromFilename(filename) {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename || "");
  if (!m) return "application/octet-stream";
  return MIME_BY_EXT[m[1].toLowerCase()] || "application/octet-stream";
}

/**
 * St-9: shared Drive file-by-name lookup. The `name='X' and 'parent' in parents
 * and trashed=false` query string was inlined in createSession, appendResult,
 * finalizeSession (in sessions/index.js), downloadSession, deleteSession,
 * and participant-files — five copies with one canonical shape. Returns
 * the raw fetch Response so callers can branch on status/body themselves.
 */
export async function searchDriveFileByName(token, folderIdentifier, fileName) {
  const q = `name='${escapeDriveQueryValue(fileName)}' and '${escapeDriveQueryValue(folderIdentifier)}' in parents and trashed=false`;
  return fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );
}

export function isSafeStorageId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(value);
}

/**
 * S-7: reject experimentID / sessionId values that would corrupt a remote
 * filesystem path (Dropbox `/`, Drive `'`/`\`, OSF URL escapes). Allowed
 * charset matches Firestore-safe doc IDs plus UUID separators.
 */
export function rejectUnsafeIds(experimentID, sessionId) {
  if (!isSafeStorageId(experimentID)) {
    return {
      success: false,
      errorCode: 400,
      errorText:
        "Invalid experimentID: must be 1-100 chars [A-Za-z0-9._-]",
    };
  }
  if (sessionId !== undefined && !isSafeStorageId(sessionId)) {
    return {
      success: false,
      errorCode: 400,
      errorText:
        "Invalid sessionId: must be 1-100 chars [A-Za-z0-9._-]",
    };
  }
  return null;
}
