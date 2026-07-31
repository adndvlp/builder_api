import fetch from "../../../../utils/fetch-with-timeout.js";

export async function uploadToDropbox(
  token,
  experimentFolder,
  relativePath,
  buffer,
  _mimeType,
) {
  const filePath = `${experimentFolder}/${relativePath}`;

  const uploadRes = await fetch(
    "https://content.dropboxapi.com/2/files/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: filePath,
          mode: "add",
          autorename: true,
          mute: false,
        }),
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    },
  );

  if (!uploadRes.ok) {
    const errData = await uploadRes.json().catch(() => ({}));
    throw new Error(
      errData.error_summary || `Dropbox upload failed (${uploadRes.status})`,
    );
  }

  const result = await uploadRes.json();

  try {
    const shareRes = await fetch(
      "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: result.path_lower }),
      },
    );
    const shareData = await shareRes.json();
    if (shareRes.ok) return shareData.url;
    if (shareData?.shared_link_already_exists?.metadata?.url) {
      return shareData.shared_link_already_exists.metadata.url;
    }
  } catch (_) {
    // Shareable link is optional.
  }

  return result.path_lower || filePath;
}

export async function uploadFile({ token, expData, filename, buffer, mimeType }) {
  const folderPath = expData.dropboxFolder || "/";
  const relativePath = `participant-files/${filename}`;
  return uploadToDropbox(token, folderPath, relativePath, buffer, mimeType);
}
