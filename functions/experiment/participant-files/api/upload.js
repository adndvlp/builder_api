import { onRequest } from "firebase-functions/v2/https";
import { db } from "../../../app.js";
import { getValidToken } from "../../../oauth/index.js";
import { uploadFileToBucket } from "../upload.js";

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

    // P-2: cap upload size to protect the 512MiB function from OOM and to
    // bound abuse via the unauthenticated participant endpoint. Counts
    // base64-decoded byte length, not the (~33% larger) data-URL string.
    const MAX_FILES_PER_REQUEST = 20;
    const MAX_BYTES_PER_FILE = 25 * 1024 * 1024; // 25 MB
    const MAX_BYTES_PER_REQUEST = 100 * 1024 * 1024; // 100 MB total

    if (files.length > MAX_FILES_PER_REQUEST) {
      res.status(413).json({
        error: `Too many files: max ${MAX_FILES_PER_REQUEST} per request`,
      });
      return;
    }

    // Validate each file entry + enforce size limits
    let totalBytes = 0;
    for (const file of files) {
      if (!file.name || !file.data || !file.type) {
        res
          .status(400)
          .json({ error: "Each file must have name, data, and type fields" });
        return;
      }
      // Estimate decoded bytes from the base64 portion of the data-URL.
      const base64Portion = file.data.includes(",")
        ? file.data.split(",")[1] ?? ""
        : file.data;
      const padding = (base64Portion.match(/=+$/) || [""])[0].length;
      const decodedBytes = Math.floor((base64Portion.length * 3) / 4) - padding;
      if (decodedBytes > MAX_BYTES_PER_FILE) {
        res.status(413).json({
          error: `File "${file.name}" exceeds per-file limit (${MAX_BYTES_PER_FILE} bytes)`,
        });
        return;
      }
      totalBytes += decodedBytes;
      if (totalBytes > MAX_BYTES_PER_REQUEST) {
        res.status(413).json({
          error: `Total upload size exceeds limit (${MAX_BYTES_PER_REQUEST} bytes)`,
        });
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
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
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
