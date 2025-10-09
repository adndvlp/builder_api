import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import validateJSON from "./validate-json.js";
import validateCSV from "./validate-csv.js";
import postFileDropbox, {
  createSessionDropbox,
  appendResultDropbox,
  listSessionsDropbox,
  downloadSessionDropbox,
  deleteSessionDropbox,
} from "./crud-file-dropbox.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import getValidDropboxToken from "./refresh-dropbox-token.js";

export const apiData = onRequest({ cors: true }, async (req, res) => {
  const { experimentID, sessionId, data, filename, action } = req.body;

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
      res.status(400).json(MESSAGES.SESSION_LIMIT_REACHED);
      return;
    }
  }

  if (exp_data.useValidation) {
    let valid = false;
    if (exp_data.allowJSON) {
      const validJSON = validateJSON(data, exp_data.requiredFields);
      if (validJSON) {
        valid = true;
      }
    }
    if (exp_data.allowCSV && !valid) {
      const validCSV = validateCSV(data, exp_data.requiredFields);
      if (validCSV) {
        valid = true;
      }
    }
    if (!valid) {
      res.status(400).json(MESSAGES.INVALID_DATA);
      return;
    }
  }

  // Obtener token válido de Dropbox (refresca automáticamente si es necesario)
  const tokenResult = await getValidDropboxToken(exp_data.owner);

  if (!tokenResult.success) {
    res.status(400).json(MESSAGES.INVALID_DROPBOX_TOKEN);
    return;
  }

  const result = await postFileDropbox(
    exp_data.dropboxFolder,
    tokenResult.access_token,
    data,
    filename
  );

  if (!result.success) {
    if (result.errorCode === 409 && result.errorText === "Conflict") {
      res.status(400).json(MESSAGES.DROPBOX_FILE_EXISTS);
      return;
    }
    res.status(400).json(MESSAGES.DROPBOX_UPLOAD_ERROR);
    return;
  }

  await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });

  res.status(201).json(MESSAGES.SUCCESS);
});

// Función auxiliar para crear sesión
async function handleCreateSession(req, res, experimentID, sessionId) {
  try {
    await writeLog(experimentID, "createSession");

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
        res.status(400).json(MESSAGES.SESSION_LIMIT_REACHED);
        return;
      }
    }

    // Obtener token válido de Dropbox (refresca automáticamente si es necesario)
    const tokenResult = await getValidDropboxToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_DROPBOX_TOKEN);
      return;
    }

    console.log("Creating session in Dropbox:", {
      folder: exp_data.dropboxFolder,
      experimentID,
      sessionId,
    });

    // Crear la sesión en Dropbox
    const result = await createSessionDropbox(
      exp_data.dropboxFolder,
      tokenResult.access_token,
      experimentID,
      sessionId
    );

    console.log("Dropbox creation result:", result);

    if (!result.success) {
      if (result.error === "Session already exists") {
        res.status(409).json({
          success: false,
          message: "Session already exists",
        });
        return;
      }
      console.error("Failed to create session in Dropbox:", result);
      res.status(400).json({
        success: false,
        message: "Failed to create session",
        error: result.errorText,
      });
      return;
    }

    // Calcular el número de participante listando todas las sesiones
    const sessionsResult = await listSessionsDropbox(
      exp_data.dropboxFolder,
      tokenResult.access_token,
      experimentID
    );

    const participantNumber = sessionsResult.success
      ? sessionsResult.sessions.length
      : 1;

    // Incrementar contador de sesiones en Firestore
    await exp_doc_ref.set(
      { sessions: FieldValue.increment(1) },
      { merge: true }
    );

    console.log("Session created successfully:", {
      participantNumber,
      sessionId,
    });

    res.status(201).json({
      success: true,
      message: "Session created successfully",
      participantNumber: participantNumber,
      sessionId: sessionId,
    });
  } catch (error) {
    console.error("Error in handleCreateSession:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
}

// Función auxiliar para agregar resultado
async function handleAppendResult(req, res, experimentID, sessionId, data) {
  try {
    await writeLog(experimentID, "appendResult");

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

    // Obtener token válido de Dropbox (refresca automáticamente si es necesario)
    const tokenResult = await getValidDropboxToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_DROPBOX_TOKEN);
      return;
    }

    // Parsear data si viene como string
    let parsedData = data;
    if (typeof data === "string") {
      try {
        parsedData = JSON.parse(data);
      } catch (err) {
        res.status(400).json({
          success: false,
          message: "Invalid data format",
        });
        return;
      }
    }

    console.log("Appending data to session:", {
      experimentID,
      sessionId,
      dataKeys: Object.keys(parsedData),
    });

    // Agregar el resultado a la sesión en Dropbox
    const result = await appendResultDropbox(
      exp_data.dropboxFolder,
      tokenResult.access_token,
      experimentID,
      sessionId,
      parsedData
    );

    console.log("Append result:", result);

    if (!result.success) {
      if (result.error === "Session not found") {
        console.error("Session not found:", sessionId);
        res.status(404).json({
          success: false,
          message: "Session not found",
        });
        return;
      }
      console.error("Failed to append data:", result);
      res.status(400).json({
        success: false,
        message: "Failed to append data",
        error: result.errorText,
      });
      return;
    }

    console.log("Data appended successfully to session:", sessionId);

    res.status(200).json({
      success: true,
      message: "Data appended successfully",
    });
  } catch (error) {
    console.error("Error in handleAppendResult:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
}

// Función auxiliar para listar sesiones
async function handleListSessions(req, res, experimentID) {
  try {
    await writeLog(experimentID, "listSessions");

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();

    if (!exp_doc.exists) {
      res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
      return;
    }

    const exp_data = exp_doc.data();

    // Obtener token válido de Dropbox (refresca automáticamente si es necesario)
    const tokenResult = await getValidDropboxToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_DROPBOX_TOKEN);
      return;
    }

    console.log("Listing sessions from Dropbox:", {
      folder: exp_data.dropboxFolder,
      experimentID,
    });

    // Listar las sesiones desde Dropbox
    const result = await listSessionsDropbox(
      exp_data.dropboxFolder,
      tokenResult.access_token,
      experimentID
    );

    console.log("List sessions result:", result);

    if (!result.success) {
      console.error("Failed to list sessions:", result);
      res.status(400).json({
        success: false,
        message: "Failed to list sessions",
        error: result.errorText,
      });
      return;
    }

    console.log(`Found ${result.sessions.length} sessions`);

    res.status(200).json({
      success: true,
      sessions: result.sessions,
      count: result.sessions.length,
    });
  } catch (error) {
    console.error("Error in handleListSessions:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
}

// Función auxiliar para descargar sesión como CSV
async function handleDownloadSession(req, res, experimentID, sessionId) {
  try {
    await writeLog(experimentID, "downloadSession");

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();

    if (!exp_doc.exists) {
      res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
      return;
    }

    const exp_data = exp_doc.data();

    // Obtener token válido de Dropbox (refresca automáticamente si es necesario)
    const tokenResult = await getValidDropboxToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_DROPBOX_TOKEN);
      return;
    }

    console.log("Downloading session from Dropbox:", {
      folder: exp_data.dropboxFolder,
      experimentID,
      sessionId,
    });

    // Descargar la sesión desde Dropbox
    const result = await downloadSessionDropbox(
      exp_data.dropboxFolder,
      tokenResult.access_token,
      experimentID,
      sessionId
    );

    console.log("Download session result:", result);

    if (!result.success) {
      if (result.error === "Session not found") {
        res.status(404).json({
          success: false,
          message: "Session not found",
        });
        return;
      }
      console.error("Failed to download session:", result);
      res.status(400).json({
        success: false,
        message: "Failed to download session",
        error: result.error,
      });
      return;
    }

    console.log("Session downloaded successfully:", sessionId);

    res.status(200).json({
      success: true,
      csv: result.csv,
      filename: result.filename,
    });
  } catch (error) {
    console.error("Error in handleDownloadSession:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
}

// Función auxiliar para eliminar sesión
async function handleDeleteSession(req, res, experimentID, sessionId) {
  try {
    await writeLog(experimentID, "deleteSession");

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();

    if (!exp_doc.exists) {
      res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
      return;
    }

    const exp_data = exp_doc.data();

    // Obtener token válido de Dropbox (refresca automáticamente si es necesario)
    const tokenResult = await getValidDropboxToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_DROPBOX_TOKEN);
      return;
    }

    console.log("Deleting session from Dropbox:", {
      folder: exp_data.dropboxFolder,
      experimentID,
      sessionId,
    });

    // Eliminar la sesión desde Dropbox
    const result = await deleteSessionDropbox(
      exp_data.dropboxFolder,
      tokenResult.access_token,
      experimentID,
      sessionId
    );

    console.log("Delete session result:", result);

    if (!result.success) {
      console.error("Failed to delete session:", result);
      res.status(400).json({
        success: false,
        message: "Failed to delete session",
        error: result.errorText,
      });
      return;
    }

    // Decrementar contador de sesiones en Firestore
    await exp_doc_ref.set(
      { sessions: FieldValue.increment(-1) },
      { merge: true }
    );

    console.log("Session deleted successfully:", sessionId);

    res.status(200).json({
      success: true,
      message: "Session deleted successfully",
    });
  } catch (error) {
    console.error("Error in handleDeleteSession:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
}
