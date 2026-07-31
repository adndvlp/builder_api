import fetch from "../../../utils/fetch-with-timeout.js";
import { createSession, escapeDriveQueryValue } from "../storage.js";
import { mergeCsvByColumns } from "../validation/serialize.js";

export function resolveFolderIdentifier(storageProvider, expData) {
  if (storageProvider === "googledrive") return expData.driveFolderId;
  if (storageProvider === "dropbox") return expData.dropboxFolder;
  return (
    expData.osfUploadLink ||
    (expData.osfComponentId
      ? `https://files.osf.io/v1/resources/${expData.osfComponentId}/providers/osfstorage/`
      : null)
  );
}

function isPatchProvider(storageProvider) {
  return storageProvider === "googledrive" || storageProvider === "dropbox";
}

async function findDriveCsv(token, folderIdentifier, fileName) {
  const searchQuery = `name='${escapeDriveQueryValue(fileName)}' and '${escapeDriveQueryValue(folderIdentifier)}' in parents and trashed=false`;
  const searchResult = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQuery)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  const searchData = await searchResult.json();
  if (!searchData.files || searchData.files.length === 0) {
    return { fileExists: false, existingCsvContent: "" };
  }

  const fileId = searchData.files[0].id;
  const downloadResult = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!downloadResult.ok) {
    return { fileExists: true, existingCsvContent: "" };
  }

  const existingCsvContent = await downloadResult.text();
  console.log(
    `Drive: Found existing file with ${existingCsvContent.split("\n").length} lines`,
  );
  return { fileExists: true, existingCsvContent };
}

async function findDropboxCsv(token, folderIdentifier, fileName) {
  const filePath = `${folderIdentifier}/${fileName}`;
  const checkResult = await fetch(
    "https://content.dropboxapi.com/2/files/download",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
      },
    },
  );

  if (checkResult.status !== 200) {
    return { fileExists: false, existingCsvContent: "" };
  }

  const existingCsvContent = await checkResult.text();
  console.log(
    `Dropbox: Found existing file with ${existingCsvContent.split("\n").length} lines`,
  );
  return { fileExists: true, existingCsvContent };
}

async function findExistingPatchCsv(
  storageProvider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
  if (storageProvider === "googledrive") {
    return findDriveCsv(token, folderIdentifier, fileName);
  }
  if (storageProvider === "dropbox") {
    return findDropboxCsv(token, folderIdentifier, fileName);
  }
  return { fileExists: false, existingCsvContent: "" };
}

async function createStorageSession(
  storageProvider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const createResult = await createSession(
    storageProvider,
    token,
    folderIdentifier,
    experimentID,
    sessionId,
  );

  if (
    !createResult.success &&
    createResult.errorCode !== 409 &&
    createResult.error !== "Session already exists"
  ) {
    throw new Error(
      createResult.errorText ||
        createResult.error ||
        `Error creating session in ${storageProvider}`,
    );
  }
}

export async function prepareStorageCsv({
  storageProvider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
  finalCsv,
}) {
  const isPatchMode = isPatchProvider(storageProvider);
  let fileExists = false;
  let csvToUpload = finalCsv;

  if (isPatchMode) {
    const existing = await findExistingPatchCsv(
      storageProvider,
      token,
      folderIdentifier,
      experimentID,
      sessionId,
    );
    fileExists = existing.fileExists;

    if (fileExists && existing.existingCsvContent) {
      csvToUpload = mergeCsvByColumns(existing.existingCsvContent, finalCsv);
    } else {
      await createStorageSession(
        storageProvider,
        token,
        folderIdentifier,
        experimentID,
        sessionId,
      );
      console.log(`PATCH mode: Created new file for session ${sessionId}`);
    }
  } else {
    await createStorageSession(
      storageProvider,
      token,
      folderIdentifier,
      experimentID,
      sessionId,
    );
  }

  return { finalCsv: csvToUpload, fileExists, isPatchMode };
}
