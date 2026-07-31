import fetch from "../../../../../utils/fetch-with-timeout.js";

export async function appendResult(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
  csvContent,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
  const uploadLink = folderIdentifier;

  if (!uploadLink) {
    return {
      success: false,
      errorText:
        "OSF upload link is not configured. Please update the experiment settings.",
    };
  }

  let existingFileUploadUrl = null;
  try {
    const componentIdMatch = uploadLink.match(/\/resources\/([^/]+)\//);
    if (componentIdMatch) {
      const componentId = componentIdMatch[1];
      const filesLink = `https://api.osf.io/v2/nodes/${componentId}/files/osfstorage/`;
      const filesResponse = await fetch(filesLink, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (filesResponse.ok) {
        const filesData = await filesResponse.json();
        const existing = filesData.data?.find(
          (f) => f.attributes.name === fileName,
        );
        if (existing) {
          existingFileUploadUrl = existing.links?.upload;
        }
      }
    }
  } catch (lookupError) {
    console.log(
      "OSF: Could not look up existing file, will attempt create:",
      lookupError.message,
    );
  }

  let uploadResult;
  if (existingFileUploadUrl) {
    uploadResult = await fetch(existingFileUploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "text/csv",
        Authorization: `Bearer ${token}`,
      },
      body: csvContent,
    });
  } else {
    const queryParams = new URLSearchParams({
      type: "files",
      name: fileName,
    });
    const uploadUrl = `${uploadLink}?${queryParams.toString()}`;
    uploadResult = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "text/csv",
        Authorization: `Bearer ${token}`,
      },
      body: csvContent,
    });
  }

  if (!uploadResult.ok) {
    const errorText = await uploadResult.text();
    return {
      success: false,
      errorText: errorText || "Error uploading session file",
      errorCode: uploadResult.status,
    };
  }

  const result = await uploadResult.json();
  return {
    success: true,
    id: result.data?.id,
    fileUrl: result.data?.links?.download || null,
  };
}
