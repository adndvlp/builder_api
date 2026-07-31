import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../../app.js";
import writeLog from "../logging/write-log.js";
import MESSAGES from "../../api/messages.js";
import validateCSV from "../validation/validate-csv.js";
import validateJSON from "../validation/validate-json.js";
import { getValidToken } from "../../../oauth/index.js";
import { finalizeSession } from "../finalization/finalize.js";
import { postFile } from "../storage.js";
import {
  handleCreateSession,
  handleAppendResult,
  handleListSessions,
  handleDownloadSession,
  handleDeleteSession,
} from "../handler.js";

/**
 * Endpoint HTTP principal para manejo de datos
 */
export const apiData = onRequest({ cors: true }, async (req, res) => {
  const { experimentID, sessionId, data, filename, action } = req.body;

  // T-2: admin actions on apiData require Firebase Auth. The default (no
  // `action`) and `finish` paths remain PUBLIC — those are called from the
  // participant runtime in GH Pages without auth context.
  const ADMIN_ACTIONS = new Set([
    "list",
    "download",
    "delete",
    "updateSessionName",
  ]);
  if (ADMIN_ACTIONS.has(action)) {
    const { requireAuth } = await import("../../../utils/auth.js");
    const authedUid = await requireAuth(req, res, { requireMatchingUid: false });
    if (!authedUid) return;
    // Verify the authed user owns this experiment.
    const expDoc = await db.collection("experiments").doc(experimentID).get();
    if (!expDoc.exists) {
      res.status(404).json({ success: false, message: "Experiment not found" });
      return;
    }
    if (expDoc.data().owner && expDoc.data().owner !== authedUid) {
      res.status(403).json({
        success: false,
        message: "Authenticated user does not own this experiment",
      });
      return;
    }
  }

  // Manejar diferentes acciones según el parámetro 'action'
  if (action === "list" && experimentID) {
    return await handleListSessions(req, res, experimentID);
  }

  if (action === "download" && experimentID && sessionId) {
    return await handleDownloadSession(req, res, experimentID, sessionId);
  }

  if (action === "delete" && experimentID && sessionId) {
    return await handleDeleteSession(req, res, experimentID, sessionId);
  }

  if (action === "finish" && experimentID && sessionId) {
    try {
      const result = await finalizeSession(experimentID, sessionId);
      res.status(200).json(result);
    } catch (error) {
      console.error(
        `[apiData] finish action failed: experimentID=${experimentID} sessionId=${sessionId}`,
        error,
      );
      handleFinalizationError(res, error);
    }
    return;
  }

  // Update session name in session_metadata
  if (action === "updateSessionName" && experimentID && sessionId) {
    const { sessionName } = req.body;
    // S-13: validate type, length, and control-character content to avoid
    // bloated Firestore docs and injected newlines/tabs in CSV metadata.
    if (typeof sessionName !== "string") {
      res.status(400).json({ error: "sessionName must be a string" });
      return;
    }
    const trimmed = sessionName.trim();
    if (trimmed.length === 0) {
      res.status(400).json({ error: "sessionName is required" });
      return;
    }
    if (trimmed.length > 200) {
      res.status(400).json({ error: "sessionName must be <= 200 characters" });
      return;
    }
    if (/[\x00-\x1F]/.test(trimmed)) {
      res
        .status(400)
        .json({ error: "sessionName cannot contain control characters" });
      return;
    }
    try {
      await db
        .collection("experiments")
        .doc(experimentID)
        .collection("session_metadata")
        .doc(sessionId)
        .set({ sessionName: trimmed }, { merge: true });
      res.status(200).json({ success: true });
    } catch (e) {
      console.error("updateSessionName error:", e);
      res.status(500).json({ error: "Internal server error" });
    }
    return;
  }

  // Detectar si es creación de sesión (experimentID, sessionId, sin data ni filename)
  if (experimentID && sessionId && !data) {
    return await handleCreateSession(req, res, experimentID, sessionId);
  }

  // Detectar si es append de resultado (experimentID, sessionId y data)
  if (experimentID && sessionId && data) {
    return await handleAppendResult(req, res, experimentID, sessionId, data);
  }

  // Flujo original: guardar archivo completo (experimentID, data y filename)
  if (!experimentID || !data || !filename) {
    res.status(400).json(MESSAGES.MISSING_PARAMETER);
    return;
  }

  await handlePostFile(req, res, experimentID, data, filename);
});

/**
 * Función auxiliar para guardar archivo completo (legacy)
 */
async function handlePostFile(req, res, experimentID, data, filename) {
  await writeLog(experimentID, "saveData");

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

  if (exp_data.limitSessions) {
    if (exp_data.sessions >= exp_data.maxSessions) {
      res.status(400).json(MESSAGES.MAX_SESSIONS_REACHED);
      return;
    }
  }

  if (exp_data.useValidation) {
    let result = { valid: false, reason: "NO_VALIDATOR" };
    if (exp_data.allowJSON) {
      result = validateJSON(data, exp_data.requiredFields);
    }
    if (!result.valid && exp_data.allowCSV) {
      result = validateCSV(data, exp_data.requiredFields);
    }
    if (!result.valid) {
      // Misc-3: surface validator reason + missing fields.
      res.status(400).json({
        ...MESSAGES.INVALID_DATA,
        reason: result.reason,
        ...(result.missingFields && { missingFields: result.missingFields }),
      });
      return;
    }
  }

  const storageProvider = exp_data.storageProvider || "googledrive";
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

  const result = await postFile(
    storageProvider,
    tokenResult.access_token,
    folderIdentifier,
    data,
    filename,
  );

  if (!result.success) {
    if (result.errorCode === 409) {
      res.status(409).json(MESSAGES.FILE_ALREADY_EXISTS);
      return;
    }
    res
      .status(400)
      .json(
        storageProvider === "dropbox"
          ? MESSAGES.DROPBOX_UPLOAD_ERROR
          : MESSAGES.GOOGLE_DRIVE_UPLOAD_ERROR,
      );
    return;
  }

  await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
  res.status(201).json(MESSAGES.SUCCESS);
}

/**
 * Función auxiliar para manejar errores de finalización
 */
function handleFinalizationError(res, error) {
  if (error.message === "EXPERIMENT_NOT_FOUND") {
    res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
  } else if (error.message === "INVALID_GOOGLE_DRIVE_TOKEN") {
    res.status(400).json(MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN);
  } else if (error.message === "INVALID_DROPBOX_TOKEN") {
    res.status(400).json(MESSAGES.INVALID_DROPBOX_TOKEN);
  } else if (error.message === "SESSION_NOT_FOUND") {
    res.status(400).json({
      success: false,
      message: "Session not found in temporary storage",
    });
  } else if (error.message === "NO_RESULTS") {
    res.status(400).json({
      success: false,
      message: "No results to send to storage",
    });
  } else {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
}
