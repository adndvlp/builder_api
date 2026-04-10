import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import fetch from "node-fetch";
import { getValidToken } from "../oauth/index.js";

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

/**
 * Uploads a participant-submitted file to the experiment's configured storage
 * provider (Google Drive, Dropbox, or OSF).
 *
 * The experiment owner's OAuth tokens are looked up from Firestore using the
 * experimentID — no authentication is required from the participant.
 *
 * Request body (application/json):
 * {
 *   experimentID: string,
 *   sessionId?: string,
 *   files: Array<{
 *     name: string,
 *     data: string,   // base64 data-URL (e.g. "data:image/png;base64,...")
 *     type: string,   // MIME type
 *     size: number,   // bytes
 *   }>
 * }
 *
 * Response:
 * { fileUrl: string, fileUrls: string[], count: number }
 */
export const uploadParticipantFile = onRequest(
  { cors: true, memory: "512MiB" },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { experimentID, sessionId, files } = req.body ?? {};

    if (!experimentID) {
      res.status(400).json({ error: "experimentID is required" });
      return;
    }

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: "files array is required" });
      return;
    }

    // Validate each file entry
    for (const file of files) {
      if (!file.name || !file.data || !file.type) {
        res
          .status(400)
          .json({ error: "Each file must have name, data, and type fields" });
        return;
      }
    }

    // ── Load experiment metadata ─────────────────────────────────────────────
    const expRef = db.collection("experiments").doc(experimentID);
    const expDoc = await expRef.get();

    if (!expDoc.exists) {
      res.status(404).json({ error: "Experiment not found" });
      return;
    }

    const expData = expDoc.data();
    const storageProvider = expData.storageProvider || "googledrive";
    const ownerUid = expData.owner;

    if (!ownerUid) {
      res
        .status(500)
        .json({ error: "Experiment has no owner — cannot determine storage" });
      return;
    }

    // ── Obtain a valid OAuth token ───────────────────────────────────────────
    const tokenResult = await getValidToken(storageProvider, ownerUid);

    if (!tokenResult.success) {
      res.status(400).json({
        error: `Storage provider "${storageProvider}" token is invalid or missing`,
        detail: tokenResult.error,
      });
      return;
    }

    const accessToken = tokenResult.access_token;

    // ── Upload each file ─────────────────────────────────────────────────────
    const fileUrls = [];

    for (const file of files) {
      try {
        // Decode base64 data-URL
        const base64Data = file.data.includes(",")
          ? file.data.split(",")[1]
          : file.data;
        const binaryBuffer = Buffer.from(base64Data, "base64");

        const ts = Date.now();
        const safeName = (file.name || "upload").replace(
          /[^a-zA-Z0-9._-]/g,
          "_",
        );
        const prefix = sessionId ? `${sessionId}_` : "";
        const savedFilename = `${prefix}${ts}_${safeName}`;

        const url = await uploadFileToBucket(
          storageProvider,
          accessToken,
          expData,
          savedFilename,
          binaryBuffer,
          file.type,
        );

        fileUrls.push(url);

        // Write file metadata to Firestore so the builder UI can list it
        try {
          const fileDocRef = db
            .collection("experiments")
            .doc(experimentID)
            .collection("session_metadata")
            .doc(sessionId || "_unlinked")
            .collection("participant_files")
            .doc(); // auto-generated ID
          await fileDocRef.set({
            fileId: fileDocRef.id,
            sessionId: sessionId || null,
            originalName: file.name,
            filename: savedFilename,
            url,
            mimeType: file.type,
            sizeBytes: file.size || 0,
            uploadedAt: new Date().toISOString(),
          });
        } catch (metaErr) {
          console.error("Error writing participant file metadata:", metaErr);
          // Don't fail the upload — the file is already saved in storage
        }
      } catch (uploadErr) {
        console.error("Failed to upload file:", file.name, uploadErr);
        res.status(500).json({
          error: `Failed to upload "${file.name}": ${uploadErr.message}`,
        });
        return;
      }
    }

    res.json({
      fileUrl: fileUrls[0] ?? "",
      fileUrls,
      count: fileUrls.length,
    });
  },
);

// ── Provider-specific upload helpers ────────────────────────────────────────

/**
 * Delegates to the correct provider upload function.
 * @returns {Promise<string>} The public/reference URL of the uploaded file.
 */
async function uploadFileToBucket(
  provider,
  token,
  expData,
  filename,
  buffer,
  mimeType,
) {
  // Files land in a "participant-files" sub-folder within the experiment folder
  const subdir = `participant-files/${filename}`;

  if (provider === "googledrive") {
    return uploadToGoogleDrive(
      token,
      expData.driveFolderId,
      filename,
      buffer,
      mimeType,
    );
  } else if (provider === "dropbox") {
    const folderPath = expData.dropboxFolder || "/";
    return uploadToDropbox(token, folderPath, subdir, buffer, mimeType);
  } else if (provider === "osf") {
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

  throw new Error(`Unsupported storage provider: ${provider}`);
}

// ── Google Drive ─────────────────────────────────────────────────────────────

async function uploadToGoogleDrive(
  token,
  parentFolderId,
  filename,
  buffer,
  mimeType,
) {
  // Ensure "participant-files" sub-folder exists (create if missing)
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

async function getOrCreateDriveFolder(token, parentId, folderName) {
  const q = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create the folder
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
  return createData.id;
}

// ── Dropbox ──────────────────────────────────────────────────────────────────

async function uploadToDropbox(
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

  // Create a shareable link
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
    // Shareable link is optional
  }

  return result.path_lower || filePath;
}

// ── OSF ──────────────────────────────────────────────────────────────────────

async function uploadToOSF(token, uploadLink, filename, buffer, mimeType) {
  const queryParams = new URLSearchParams({ type: "files", name: filename });
  const url = `${uploadLink}?${queryParams}`;

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
