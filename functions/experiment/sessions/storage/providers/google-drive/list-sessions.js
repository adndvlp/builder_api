import fetch from "../../../../../utils/fetch-with-timeout.js";
import {
  escapeDriveQueryValue,
  makeSessionFileMatcher,
  extractSessionId,
} from "../../helpers.js";

export async function listSessions(token, folderIdentifier, experimentID) {
  const matcher = makeSessionFileMatcher(experimentID);
  const searchQuery = `'${escapeDriveQueryValue(folderIdentifier)}' in parents and trashed=false and name contains '${escapeDriveQueryValue(experimentID + "_")}'`;

  const allFiles = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({
      q: searchQuery,
      fields: "files(id,name,createdTime,modifiedTime),nextPageToken",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const listResult = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!listResult.ok) {
      const errorResult = await listResult.json();
      return {
        success: false,
        errorText: errorResult.error?.message || "Error listing sessions",
        errorCode: listResult.status,
        sessions: [],
      };
    }

    const result = await listResult.json();
    allFiles.push(...(result.files || []));
    pageToken = result.nextPageToken || null;
  } while (pageToken);

  const sessions = allFiles
    .filter((file) => matcher.test(file.name))
    .map((file) => ({
      sessionId: extractSessionId(file.name, experimentID),
      fileId: file.id,
      fileName: file.name,
      createdAt: file.createdTime,
      modifiedAt: file.modifiedTime,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { success: true, sessions };
}
