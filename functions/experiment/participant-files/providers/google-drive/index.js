import fetch from "../../../../utils/fetch-with-timeout.js";
import { escapeDriveQueryValue } from "../../../sessions/storage.js";

export async function uploadToGoogleDrive(
  token,
  parentFolderId,
  filename,
  buffer,
  mimeType,
) {
  const subfolderId = await getOrCreateDriveFolder(
    token,
    parentFolderId,
    "participant-files",
  );

  const metadata = {
    name: filename,
    mimeType,
    parents: [subfolderId],
  };

  const boundary = "----MultipartBoundary7MA4YWxkTrZu0gW";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "Content-Transfer-Encoding: base64",
    "",
    buffer.toString("base64"),
    `--${boundary}--`,
  ].join("\r\n");

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!uploadRes.ok) {
    const errData = await uploadRes.json().catch(() => ({}));
    throw new Error(
      errData.error?.message || `Drive upload failed (${uploadRes.status})`,
    );
  }

  const result = await uploadRes.json();
  return (
    result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`
  );
}

export async function getOrCreateDriveFolder(token, parentId, folderName) {
  if (!parentId) {
    throw new Error("getOrCreateDriveFolder requires a parentId");
  }

  async function findFolder() {
    const q = `name='${escapeDriveQueryValue(folderName)}' and '${escapeDriveQueryValue(parentId)}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,createdTime)&orderBy=createdTime`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const searchData = await searchRes.json();
    return searchData.files || [];
  }

  const existing = await findFolder();
  if (existing.length > 0) {
    return existing[0].id;
  }

  const createRes = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    },
  );

  const createData = await createRes.json();
  const afterCreate = await findFolder();
  if (afterCreate.length > 1) {
    console.warn(
      `[Drive] Detected ${afterCreate.length} duplicate folders named "${folderName}" - using oldest. Manual cleanup recommended.`,
    );
    return afterCreate[0].id;
  }

  return createData.id;
}

export async function uploadFile({ token, expData, filename, buffer, mimeType }) {
  return uploadToGoogleDrive(
    token,
    expData.driveFolderId,
    filename,
    buffer,
    mimeType,
  );
}
