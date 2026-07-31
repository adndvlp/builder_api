import fetch from "../../../../../utils/fetch-with-timeout.js";
import {
  makeSessionFileMatcher,
  extractSessionId,
} from "../../helpers.js";

export async function listSessions(token, folderIdentifier, experimentID) {
  const componentId = folderIdentifier;
  const nodeResponse = await fetch(
    `https://api.osf.io/v2/nodes/${componentId}/files/`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!nodeResponse.ok) {
    return {
      success: false,
      errorText: "Error accessing OSF component",
      errorCode: nodeResponse.status,
      sessions: [],
    };
  }

  const nodeData = await nodeResponse.json();
  const storageProvider = Array.isArray(nodeData?.data)
    ? nodeData.data.find((p) => p?.attributes?.name === "osfstorage")
    : null;

  if (!storageProvider) {
    return { success: true, sessions: [] };
  }

  const matcher = makeSessionFileMatcher(experimentID);
  const filesLink =
    storageProvider?.relationships?.files?.links?.related?.href;
  if (!filesLink) {
    return {
      success: false,
      errorText: "OSF response missing files link",
      errorCode: 502,
      sessions: [],
    };
  }

  const allData = [];
  let nextUrl = filesLink;
  while (nextUrl) {
    const filesResponse = await fetch(nextUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!filesResponse.ok) {
      return {
        success: false,
        errorText: "Error listing files",
        errorCode: filesResponse.status,
        sessions: [],
      };
    }
    const filesData = await filesResponse.json();
    allData.push(...(filesData.data || []));
    nextUrl = filesData.links?.next || null;
  }

  const sessions = allData
    .filter(
      (file) =>
        file.attributes.kind === "file" && matcher.test(file.attributes.name),
    )
    .map((file) => ({
      sessionId: extractSessionId(file.attributes.name, experimentID),
      fileId: file.id,
      fileName: file.attributes.name,
      createdAt: file.attributes.date_created,
      modifiedAt: file.attributes.date_modified,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { success: true, sessions };
}
