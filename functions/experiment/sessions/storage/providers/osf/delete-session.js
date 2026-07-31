import fetch from "../../../../../utils/fetch-with-timeout.js";

export async function deleteSession(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
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
    };
  }

  const nodeData = await nodeResponse.json();
  const storageProvider = Array.isArray(nodeData?.data)
    ? nodeData.data.find((p) => p?.attributes?.name === "osfstorage")
    : null;

  if (!storageProvider) {
    return { success: false, errorText: "Storage provider not found" };
  }

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

  const filesResponse = await fetch(filesLink, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!filesResponse.ok) {
    return {
      success: false,
      errorText: "Error listing files",
      errorCode: filesResponse.status,
    };
  }

  const filesData = await filesResponse.json();
  const targetFile = filesData.data.find(
    (f) => f.attributes.name === fileName,
  );

  if (!targetFile) {
    return { success: false, errorText: "Session not found", errorCode: 404 };
  }

  const deleteLink = targetFile?.links?.delete;
  if (!deleteLink) {
    return {
      success: false,
      errorText: "OSF file missing delete link",
      errorCode: 502,
    };
  }

  const deleteResponse = await fetch(deleteLink, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!deleteResponse.ok) {
    return {
      success: false,
      errorText: "Error deleting file",
      errorCode: deleteResponse.status,
    };
  }

  return { success: true, message: "Session deleted successfully" };
}
