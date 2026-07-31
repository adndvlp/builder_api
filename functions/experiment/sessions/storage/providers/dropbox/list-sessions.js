import fetch from "../../../../../utils/fetch-with-timeout.js";
import {
  makeSessionFileMatcher,
  extractSessionId,
} from "../../helpers.js";

export async function listSessions(token, folderIdentifier, experimentID) {
  const matcher = makeSessionFileMatcher(experimentID);
  const allEntries = [];

  let listResult = await fetch(
    "https://api.dropboxapi.com/2/files/list_folder",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: folderIdentifier,
        recursive: false,
      }),
    },
  );

  if (listResult.status !== 200) {
    const result = await listResult.json().catch(() => ({}));
    return {
      success: false,
      errorCode: listResult.status,
      errorText: result.error_summary || listResult.statusText,
      sessions: [],
    };
  }

  let page = await listResult.json();
  allEntries.push(...(page.entries || []));

  while (page.has_more && page.cursor) {
    const contResp = await fetch(
      "https://api.dropboxapi.com/2/files/list_folder/continue",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cursor: page.cursor }),
      },
    );
    if (contResp.status !== 200) {
      const result = await contResp.json().catch(() => ({}));
      return {
        success: false,
        errorCode: contResp.status,
        errorText: result.error_summary || contResp.statusText,
        sessions: [],
      };
    }
    page = await contResp.json();
    allEntries.push(...(page.entries || []));
  }

  const sessions = allEntries
    .filter((entry) => entry[".tag"] === "file" && matcher.test(entry.name))
    .map((entry) => ({
      sessionId: extractSessionId(entry.name, experimentID),
      experimentID,
      createdAt: entry.server_modified,
      name: entry.name,
      path: entry.path_display,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { success: true, sessions };
}
