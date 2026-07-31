import fetch from "../../../../utils/fetch-with-timeout.js";

export async function ensureOsfParticipantFolder(token, uploadLink) {
  try {
    const componentMatch = uploadLink.match(/\/resources\/([^/]+)\//);
    if (!componentMatch) return uploadLink;
    const componentId = componentMatch[1];

    const listUrl = `https://api.osf.io/v2/nodes/${componentId}/files/osfstorage/`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) return uploadLink;
    const listData = await listRes.json();

    const existing = Array.isArray(listData?.data)
      ? listData.data.find(
          (f) =>
            f?.attributes?.name === "participant-files" &&
            f?.attributes?.kind === "folder",
        )
      : null;

    if (existing?.links?.upload) {
      return existing.links.upload;
    }

    const createUrl = `${uploadLink}?kind=folder&name=participant-files`;
    const createRes = await fetch(createUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!createRes.ok) return uploadLink;
    const created = await createRes.json();
    return created?.data?.links?.upload || uploadLink;
  } catch {
    return uploadLink;
  }
}

export async function uploadToOSF(token, uploadLink, filename, buffer, mimeType) {
  const targetLink = await ensureOsfParticipantFolder(token, uploadLink);
  const queryParams = new URLSearchParams({ type: "files", name: filename });
  const url = `${targetLink}?${queryParams}`;

  const uploadRes = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType || "application/octet-stream",
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(errText || `OSF upload failed (${uploadRes.status})`);
  }

  const result = await uploadRes.json();
  const fileId = result.data?.id;
  return fileId
    ? `https://osf.io/${fileId}/`
    : uploadLink.replace("files.osf.io/v1/resources", "osf.io").split("?")[0];
}

export async function uploadFile({ token, expData, filename, buffer, mimeType }) {
  const uploadLink =
    expData.osfUploadLink ||
    (expData.osfComponentId
      ? `https://files.osf.io/v1/resources/${expData.osfComponentId}/providers/osfstorage/`
      : null);
  if (!uploadLink) {
    throw new Error("OSF upload link not configured for this experiment");
  }
  return uploadToOSF(token, uploadLink, filename, buffer, mimeType);
}
