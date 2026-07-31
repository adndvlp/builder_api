import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { Parser } from "json2csv";
import { db } from "../../../app.js";
import writeLog from "../logging/write-log.js";
import MESSAGES from "../../api/messages.js";
import { getValidToken } from "../../../oauth/index.js";
import { appendResult } from "../storage.js";

/**
 * Endpoint para enviar experimento completo directo al storage (sin Firestore)
 * Usado cuando batchSize = 0 (enviar todo al final)
 */
export const apiDataComplete = onRequest({ cors: true }, async (req, res) => {
  const { experimentID, sessionId, trialsData, storage, metadata } = req.body;

  if (!experimentID || !sessionId || !trialsData) {
    res.status(400).json({
      success: false,
      message:
        "Missing required parameters: experimentID, sessionId, trialsData",
    });
    return;
  }

  try {
    await writeLog(experimentID, "saveCompleteExperiment");

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();

    if (!exp_doc.exists) {
      res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
      return;
    }

    const exp_data = exp_doc.data();
    if (!exp_data.active) {
      res.status(400).json(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
      return;
    }

    const storageProvider =
      storage || exp_data.storageProvider || "googledrive";

    console.log("Saving complete experiment directly to storage:", {
      experimentID,
      sessionId,
      storageProvider,
      trialsCount: Array.isArray(trialsData) ? trialsData.length : 0,
    });

    // Convertir trials JSON a CSV
    let csvData;
    try {
      // Asegurar que trialsData sea un array
      const trials = Array.isArray(trialsData) ? trialsData : [trialsData];

      // Extraer todos los campos únicos
      const allFields = Array.from(
        new Set(trials.flatMap((row) => Object.keys(row))),
      );

      // Convertir a CSV usando json2csv
      const parser = new Parser({ fields: allFields });
      csvData = parser.parse(trials);

      console.log(`Converted ${trials.length} trials to CSV`);
    } catch (err) {
      console.error("Error converting to CSV:", err);
      res.status(400).json({
        success: false,
        message: "Error converting data to CSV",
        error: err.message,
      });
      return;
    }

    // Obtener token válido
    const tokenResult = await getValidToken(storageProvider, exp_data.owner);

    if (!tokenResult.success) {
      res
        .status(400)
        .json(
          storageProvider === "dropbox"
            ? MESSAGES.INVALID_DROPBOX_TOKEN
            : storageProvider === "osf"
              ? MESSAGES.INVALID_OSF_TOKEN
              : MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN,
        );
      return;
    }

    const folderIdentifier =
      storageProvider === "googledrive"
        ? exp_data.driveFolderId
        : storageProvider === "dropbox"
          ? exp_data.dropboxFolder
          : exp_data.osfUploadLink ||
            (exp_data.osfComponentId
              ? `https://files.osf.io/v1/resources/${exp_data.osfComponentId}/providers/osfstorage/`
              : null);

    // Con batch=0, NO crear sesión para NINGÚN proveedor
    // El CSV completo se envía directo sin archivo vacío previo
    console.log(
      `Skipping session creation (batch=0), sending complete CSV for ${storageProvider}`,
    );

    // Enviar el CSV directamente al storage
    const appendResult_ = await appendResult(
      storageProvider,
      tokenResult.access_token,
      folderIdentifier,
      experimentID,
      sessionId,
      csvData,
    );

    if (!appendResult_.success) {
      res.status(400).json({
        success: false,
        message: `Failed to send data to ${storageProvider}`,
        error: appendResult_.errorText,
      });
      return;
    }

    console.log(`Complete experiment saved to ${storageProvider} successfully`);

    // Guardar metadata con link de archivo en Firestore
    try {
      const fileUrl =
        storageProvider === "googledrive" && appendResult_.id
          ? `https://drive.google.com/uc?export=download&id=${appendResult_.id}`
          : (storageProvider === "dropbox" || storageProvider === "osf") &&
              appendResult_.fileUrl
            ? appendResult_.fileUrl
            : null;
      // S-9: write the same shape `finalizeSession` writes so the
      // investigator view doesn't show less detail for batch=0 sessions
      // (state/metadata/createdAt/sessionName were missing previously).
      const nowIso = new Date().toISOString();
      const trialCount = Array.isArray(trialsData) ? trialsData.length : 0;
      await db
        .collection("experiments")
        .doc(experimentID)
        .collection("session_metadata")
        .doc(sessionId)
        .set(
          {
            sessionId,
            state: "completed",
            createdAt: nowIso,
            completedAt: nowIso,
            storageProvider,
            metadata: metadata || {},
            trialCount,
            ...(fileUrl && { fileUrl }),
          },
          { merge: true },
        );
    } catch (metaErr) {
      console.error(
        "Error saving session_metadata in apiDataComplete:",
        metaErr,
      );
    }

    // S-10: increment the experiment's sessions counter. Default-flow runs
    // (batch=0) also count as sessions for analytics — `handleCreateSession`
    // and `handlePostFile` already increment; this aligns the missing path.
    try {
      await exp_doc_ref.set(
        { sessions: FieldValue.increment(1) },
        { merge: true },
      );
    } catch (counterErr) {
      console.error(
        "Error incrementing sessions counter in apiDataComplete:",
        counterErr,
      );
    }

    res.status(201).json({
      success: true,
      message: "Complete experiment saved successfully to storage",
      storageProvider,
    });
  } catch (error) {
    // T-11: log internal detail; respond generic.
    console.error("Error in apiDataComplete:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});
