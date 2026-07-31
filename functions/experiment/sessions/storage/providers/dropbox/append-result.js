import fetch from "../../../../../utils/fetch-with-timeout.js";

export async function appendResult(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
  csvContent,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
  const filePath = `${folderIdentifier}/${fileName}`;

  const uploadResult = await fetch(
    "https://content.dropboxapi.com/2/files/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: filePath,
          mode: "overwrite",
          autorename: false,
          mute: false,
        }),
        "Content-Type": "application/octet-stream",
      },
      body: csvContent,
    },
  );

  if (uploadResult.status !== 200) {
    const result = await uploadResult.json().catch(() => ({}));
    return {
      success: false,
      errorCode: uploadResult.status,
      errorText: result.error_summary || uploadResult.statusText,
    };
  }

  const result = await uploadResult.json();
  let fileUrl = null;

  try {
    const shareRes = await fetch(
      "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: filePath }),
      },
    );
    const shareData = await shareRes.json();
    if (shareRes.status === 200) {
      fileUrl = shareData.url;
    } else if (
      shareRes.status === 409 &&
      shareData?.shared_link_already_exists?.metadata?.url
    ) {
      fileUrl = shareData.shared_link_already_exists.metadata.url;
    }
  } catch (_) {
    // Sharing links are optional for session persistence.
  }

  return {
    success: true,
    id: result.id,
    filePath,
    fileUrl,
  };
}
