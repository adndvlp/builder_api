import fetch from "../../../../../utils/fetch-with-timeout.js";

export async function createSession(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
  const initialCSV = "";
  const uploadLink = folderIdentifier;

  const queryParams = new URLSearchParams({
    type: "files",
    name: fileName,
  });

  const uploadUrl = `${uploadLink}?${queryParams.toString()}`;
  const uploadResult = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "text/csv",
      Authorization: `Bearer ${token}`,
    },
    body: initialCSV,
  });

  if (!uploadResult.ok) {
    const errorText = await uploadResult.text();
    return {
      success: false,
      errorText: errorText || "Error creating session",
      errorCode: uploadResult.status,
    };
  }

  const result = await uploadResult.json();
  return { success: true, id: result.data?.id };
}
