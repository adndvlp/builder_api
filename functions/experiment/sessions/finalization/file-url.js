import fetch from "../../../utils/fetch-with-timeout.js";
import { db } from "../../../app.js";
import { getValidToken } from "../../../oauth/index.js";
import { escapeDriveQueryValue } from "../storage.js";

async function lookupDriveFileUrl(token, expData, fileName) {
  if (!expData.driveFolderId) return null;

  const searchQuery = `name='${escapeDriveQueryValue(fileName)}' and '${escapeDriveQueryValue(expData.driveFolderId)}' in parents and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQuery)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return `https://drive.google.com/uc?export=download&id=${searchData.files[0].id}`;
  }
  return null;
}

async function lookupDropboxFileUrl(token, expData, fileName) {
  if (!expData.dropboxFolder) return null;

  try {
    const filePath = `${expData.dropboxFolder}/${fileName}`;
    const listRes = await fetch(
      "https://api.dropboxapi.com/2/sharing/list_shared_links",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: filePath,
          direct_only: true,
        }),
      },
    );

    if (listRes.ok) {
      const listData = await listRes.json();
      const existingUrl = listData.links?.[0]?.url || null;
      if (existingUrl) return existingUrl;
    }

    const createRes = await fetch(
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
    const createData = await createRes.json();
    if (createRes.status === 200) return createData.url;
    if (
      createRes.status === 409 &&
      createData?.shared_link_already_exists?.metadata?.url
    ) {
      return createData.shared_link_already_exists.metadata.url;
    }
  } catch (dropboxErr) {
    console.error("Error getting Dropbox sharing link in CASO 2:", dropboxErr);
  }

  return null;
}

async function lookupOsfFileUrl(token, expData, fileName) {
  const osfUploadLink =
    expData.osfUploadLink ||
    (expData.osfComponentId
      ? `https://files.osf.io/v1/resources/${expData.osfComponentId}/providers/osfstorage/`
      : null);
  if (!osfUploadLink) return null;

  const componentIdMatch = osfUploadLink.match(/\/resources\/([^/]+)\//);
  if (!componentIdMatch) return null;

  const componentId = componentIdMatch[1];
  const filesRes = await fetch(
    `https://api.osf.io/v2/nodes/${componentId}/files/osfstorage/`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!filesRes.ok) return null;
  const filesData = await filesRes.json();
  const found = filesData.data?.find((f) => f.attributes.name === fileName);
  return found?.links?.download || null;
}

export async function lookupSessionFileUrl(experimentID, sessionId) {
  try {
    const expDoc = await db.collection("experiments").doc(experimentID).get();
    if (!expDoc.exists) return null;

    const expData = expDoc.data();
    const provider = expData.storageProvider || "googledrive";
    const fileName = `${experimentID}_${sessionId}.csv`;
    const tokenResult = await getValidToken(provider, expData.owner);
    if (!tokenResult.success) return null;

    if (provider === "googledrive") {
      return lookupDriveFileUrl(tokenResult.access_token, expData, fileName);
    }
    if (provider === "dropbox") {
      return lookupDropboxFileUrl(tokenResult.access_token, expData, fileName);
    }
    if (provider === "osf") {
      return lookupOsfFileUrl(tokenResult.access_token, expData, fileName);
    }
  } catch (lookupErr) {
    console.error("Error looking up file URL in CASO 2:", lookupErr);
  }

  return null;
}
