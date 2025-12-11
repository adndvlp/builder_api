import { onRequest } from "firebase-functions/v2/https";
import { onValueWritten } from "firebase-functions/v2/database";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../app.js";
import writeLog from "../write-log.js";
import MESSAGES from "../api-messages.js";
import validateCSV from "../validate-csv.js";
import validateJSON from "../validate-json.js";
import { Parser } from "json2csv";
import { getValidToken } from "../services/oauth.js";
import {
  createSession,
  appendResult,
  listSessions,
  downloadSession,
  deleteSession,
  postFile,
} from "../services/storage.js";
import { createExperiment } from "./experiments.js";

/**
 * Endpoint HTTP principal para manejo de datos
 */
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

  if (action === "finish" && experimentID && sessionId) {
    try {
      const result = await finalizeSession(experimentID, sessionId);
      res.status(200).json(result);
    } catch (error) {
      console.error("Error in finish action:", error);
      handleFinalizationError(res, error);
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
    let valid = false;
    if (exp_data.allowJSON) {
      valid = validateJSON(data, exp_data.requiredFields);
    }
    if (exp_data.allowCSV && !valid) {
      valid = validateCSV(data, exp_data.requiredFields);
    }
    if (!valid) {
      res.status(400).json(MESSAGES.INVALID_DATA);
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
          : MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN
      );
    return;
  }

  const folderIdentifier =
    storageProvider === "googledrive"
      ? exp_data.driveFolderId
      : exp_data.dropboxFolder;

  const result = await postFile(
    storageProvider,
    tokenResult.access_token,
    folderIdentifier,
    data,
    filename
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
          : MESSAGES.GOOGLE_DRIVE_UPLOAD_ERROR
      );
    return;
  }

  await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
  res.status(201).json(MESSAGES.SUCCESS);
}

/**
 * Función auxiliar para crear sesión
 */
async function handleCreateSession(req, res, experimentID, sessionId) {
  try {
    await writeLog(experimentID, "createSession");

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    let exp_doc = await exp_doc_ref.get();

    // Si no existe el experimento, créalo directamente aquí
    if (!exp_doc.exists) {
      const storageProvider = req.body.storageProvider || "googledrive";
      await exp_doc_ref.set(
        {
          title: experimentID,
          owner: req.body.uid || "unknown",
          active: true,
          sessions: 0,
          storageProvider: storageProvider,
          ...(storageProvider === "googledrive" && {
            driveFolderId: null,
            driveFolderPath: null,
          }),
          ...(storageProvider === "dropbox" && {
            dropboxFolder: null,
          }),
        },
        { merge: true }
      );
      exp_doc = await exp_doc_ref.get();
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

    const storageProvider = exp_data.storageProvider || "googledrive";
    const tokenResult = await getValidToken(storageProvider, exp_data.owner);

    if (!tokenResult.success) {
      res
        .status(400)
        .json(
          storageProvider === "dropbox"
            ? MESSAGES.INVALID_DROPBOX_TOKEN
            : MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN
        );
      return;
    }

    let folderIdentifier =
      storageProvider === "googledrive"
        ? exp_data.driveFolderId
        : exp_data.dropboxFolder;

    // Si no hay folderIdentifier, crear la carpeta ahora
    if (!folderIdentifier && exp_data.driveFolderPath) {
      console.log(
        `No folder ID found, creating folder at ${exp_data.driveFolderPath}`
      );

      const { createFolder } = await import("../services/storage.js");
      const folderResult = await createFolder(
        storageProvider,
        tokenResult.access_token,
        exp_data.driveFolderPath
      );

      if (folderResult.success && folderResult.folderId) {
        folderIdentifier = folderResult.folderId;

        // Actualizar el experimento con el folderId
        await exp_doc_ref.update({
          driveFolderId: folderIdentifier,
        });

        console.log(
          `Folder created and experiment updated with folderId: ${folderIdentifier}`
        );
      } else {
        console.error(`Failed to create folder:`, folderResult);
      }
    }

    console.log(`Creating session in ${storageProvider}:`, {
      folderIdentifier,
      experimentID,
      sessionId,
    });

    let result = await createSession(
      storageProvider,
      tokenResult.access_token,
      folderIdentifier,
      experimentID,
      sessionId
    );

    console.log(`${storageProvider} creation result:`, result);

    // Si error 404 o 400, crear experimento completo
    if (
      !result.success &&
      (result.errorCode === 404 || result.errorCode === 400)
    ) {
      try {
        console.log(
          `Creating experiment using createExperiment for ${storageProvider}`
        );

        await createExperiment(
          experimentID,
          experimentID,
          req.body.uid || "unknown",
          storageProvider
        );

        // Obtener los datos actualizados del experimento
        const updated_exp_doc = await exp_doc_ref.get();
        const updated_exp_data = updated_exp_doc.data();
        const updated_folderIdentifier =
          storageProvider === "googledrive"
            ? updated_exp_data.driveFolderId
            : updated_exp_data.dropboxFolder;

        // Reintentar crear la sesión con los datos actualizados
        result = await createSession(
          storageProvider,
          tokenResult.access_token,
          updated_folderIdentifier,
          experimentID,
          sessionId
        );
        console.log(`Retry ${storageProvider} creation result:`, result);
      } catch (err) {
        console.error("Error creating experiment and retrying session:", err);
        res.status(500).json({
          success: false,
          message: "Error creating experiment and retrying session",
          error: err.message,
        });
        return;
      }
    }

    if (!result.success) {
      if (
        result.errorCode === 409 ||
        result.error === "Session already exists"
      ) {
        res.status(409).json({
          success: false,
          message: "Session already exists",
          errorCode: 409,
        });
        return;
      }
      res.status(400).json({
        success: false,
        message: result.errorText || result.error || "Error creating session",
      });
      return;
    }

    // Calcular el número de participante listando todas las sesiones
    const sessionsResult = await listSessions(
      storageProvider,
      tokenResult.access_token,
      folderIdentifier,
      experimentID
    );

    const participantNumber = sessionsResult.success
      ? sessionsResult.sessions.length + 1
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

/**
 * Función auxiliar para agregar resultado (guarda en Firestore temporalmente)
 */
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

    // Siempre guardar como JSON
    let parsedData = data;
    if (typeof data === "string") {
      try {
        parsedData = JSON.parse(data);
      } catch (err) {
        res.status(400).json({
          success: false,
          message: "Invalid JSON in data parameter",
        });
        return;
      }
    }

    // Validar los datos si está configurado
    if (exp_data.useValidation) {
      let valid = false;
      if (exp_data.allowJSON) {
        valid = validateJSON(
          JSON.stringify([parsedData]),
          exp_data.requiredFields
        );
      }
      if (!valid) {
        res.status(400).json(MESSAGES.INVALID_DATA);
        return;
      }
    }

    console.log("Appending JSON result to Firestore temporarily:", {
      experimentID,
      sessionId,
    });

    // Guardar el resultado temporalmente en Firestore
    const session_ref = db
      .collection("experiments")
      .doc(experimentID)
      .collection("sessions")
      .doc(sessionId);

    const session_doc = await session_ref.get();

    if (!session_doc.exists) {
      await session_ref.set({
        createdAt: FieldValue.serverTimestamp(),
        results: [parsedData],
      });
    } else {
      await session_ref.update({
        results: FieldValue.arrayUnion(parsedData),
      });
    }

    console.log("JSON result appended to Firestore successfully");

    res.status(201).json({
      success: true,
      message: "JSON result appended successfully to temporary storage",
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

/**
 * Función auxiliar INTERNA para finalizar sesión (lógica pura sin req/res)
 * Esta función puede ser llamada desde el endpoint HTTP o desde Cloud Functions
 */
export async function finalizeSession(experimentID, sessionId) {
  await writeLog(experimentID, "finishSession");

  const exp_doc_ref = db.collection("experiments").doc(experimentID);
  const exp_doc = await exp_doc_ref.get();

  if (!exp_doc.exists) {
    throw new Error("EXPERIMENT_NOT_FOUND");
  }

  const exp_data = exp_doc.data();
  const storageProvider = exp_data.storageProvider || "googledrive";

  // Obtener token válido
  const tokenResult = await getValidToken(storageProvider, exp_data.owner);

  if (!tokenResult.success) {
    throw new Error(
      storageProvider === "dropbox"
        ? "INVALID_DROPBOX_TOKEN"
        : "INVALID_GOOGLE_DRIVE_TOKEN"
    );
  }

  console.log("Finishing session - fetching results from Firestore:", {
    experimentID,
    sessionId,
  });

  // Leer el estado desde Firebase Realtime Database
  let sessionState = null;
  try {
    const rtdb = admin.database();
    const sessionSnapshot = await rtdb
      .ref(`sessions/${experimentID}/${sessionId}`)
      .once("value");
    const sessionData = sessionSnapshot.val();
    if (sessionData && sessionData.state) {
      sessionState = sessionData.state;
      console.log(`Session state from Realtime DB: ${sessionState}`);
    }
  } catch (error) {
    console.error("Error reading state from Realtime Database:", error);
    // Continuar sin estado si hay error
  }

  // Obtener todos los resultados de Firestore
  const session_ref = db
    .collection("experiments")
    .doc(experimentID)
    .collection("sessions")
    .doc(sessionId);

  const session_doc = await session_ref.get();

  if (!session_doc.exists) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const session_data = session_doc.data();
  const results = session_data.results || [];

  if (results.length === 0) {
    throw new Error("NO_RESULTS");
  }

  // Extraer todos los campos únicos de los resultados
  const allFields = Array.from(
    new Set(results.flatMap((row) => Object.keys(row)))
  );

  // Convertir a CSV con json2csv usando los campos detectados
  const parser = new Parser({ fields: allFields });
  let finalCsv;
  try {
    finalCsv = parser.parse(results);
  } catch (err) {
    throw new Error("Error converting results to CSV: " + err.message);
  }

  console.log(`Final CSV to send to ${storageProvider}:\n${finalCsv}`);

  const folderIdentifier =
    storageProvider === "googledrive"
      ? exp_data.driveFolderId
      : exp_data.dropboxFolder;

  // Crear la sesión si no existe
  const createResult = await createSession(
    storageProvider,
    tokenResult.access_token,
    folderIdentifier,
    experimentID,
    sessionId
  );

  // Si la sesión ya existe (409), continuamos de todas formas
  if (
    !createResult.success &&
    createResult.errorCode !== 409 &&
    createResult.error !== "Session already exists"
  ) {
    throw new Error(
      createResult.errorText ||
        createResult.error ||
        `Error creating session in ${storageProvider}`
    );
  }

  // Enviar el CSV final al storage
  const appendResult_ = await appendResult(
    storageProvider,
    tokenResult.access_token,
    folderIdentifier,
    experimentID,
    sessionId,
    finalCsv
  );

  if (!appendResult_.success) {
    throw new Error(
      appendResult_.errorText || `Failed to send results to ${storageProvider}`
    );
  }

  console.log(`All results sent to ${storageProvider}, cleaning up Firestore`);

  // Limpiar los datos temporales de Firestore
  await session_ref.delete();

  console.log("Session finished and cleaned up successfully");

  return {
    success: true,
    message: "Session finished successfully",
    resultsSent: results.length,
  };
}

/**
 * Cloud Function para finalizar sesiones desconectadas automáticamente
 * Se dispara cuando se actualiza un nodo en /sessions/{experimentID}/{sessionId}
 */
export const finalizeDisconnectedSessions = onValueWritten(
  {
    ref: "/sessions/{experimentID}/{sessionId}",
    region: "us-central1",
  },
  async (event) => {
    const beforeData = event.data.before.val();
    const afterData = event.data.after.val();

    // Si no existe el nodo después del cambio, salir
    if (!afterData) {
      return null;
    }

    // Si ya fue procesado, salir inmediatamente (esto evita reprocesar)
    if (afterData.finalizationProcessed === true) {
      return null;
    }

    // SOLO procesar si needsFinalization está en true
    if (afterData.needsFinalization !== true) {
      return null;
    }

    // IMPORTANTE: Solo procesar si cambió de connected=true a connected=false
    // Esto garantiza que es una desconexión/finalización real
    const wasConnected = beforeData?.connected === true;
    const isNowDisconnected = afterData.connected === false;

    if (!wasConnected || !isNowDisconnected) {
      // No es una transición de conectado a desconectado, salir
      return null;
    }

    const experimentID = event.params.experimentID;
    const sessionId = event.params.sessionId;
    const isAbandoned = afterData.state === "abandoned";

    console.log(
      `Processing session finalization: ${experimentID}/${sessionId}`,
      `finished: ${
        afterData.finished || false
      }, disconnected: ${!afterData.connected}, state: ${
        afterData.state || "unknown"
      }`
    );

    try {
      // Si fue abandonado, guardar estado en db.json local
      if (isAbandoned && afterData.metadata) {
        // Llamar endpoint para persistir metadata con estado abandoned
        const https = await import("https");
        const postData = JSON.stringify({
          sessionId: sessionId,
          metadata: afterData.metadata,
          state: "abandoned",
        });

        // Este endpoint debe estar accesible desde Cloud Functions
        // Por ahora solo lo registramos en logs
        console.log(
          `Session ${sessionId} marked as abandoned with metadata:`,
          afterData.metadata
        );
      }

      // Usar la función unificada que determina el storage provider automáticamente
      const result = await finalizeSession(experimentID, sessionId);

      // Marcar como procesado en Realtime Database
      await event.data.after.ref.update({
        finalizationProcessed: true,
        processedAt: Date.now(),
        resultsSent: result.resultsSent,
      });

      console.log(`Session ${sessionId} finalized successfully`);
      return null;
    } catch (error) {
      console.error(`Error finalizing session ${sessionId}:`, error);

      // Si el error es que no hay datos (SESSION_NOT_FOUND o NO_RESULTS),
      // también marcar como procesado para evitar reintentos
      const isNoDataError =
        error.message === "SESSION_NOT_FOUND" || error.message === "NO_RESULTS";

      await event.data.after.ref.update({
        finalizationProcessed: true,
        finalizationError: error.message,
        processedAt: Date.now(),
        ...(isNoDataError && { noDataToFinalize: true }),
      });

      return null;
    }
  }
);

/**
 * Función auxiliar para listar sesiones
 */
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
    const storageProvider = exp_data.storageProvider || "googledrive";

    const tokenResult = await getValidToken(storageProvider, exp_data.owner);

    if (!tokenResult.success) {
      res
        .status(400)
        .json(
          storageProvider === "dropbox"
            ? MESSAGES.INVALID_DROPBOX_TOKEN
            : MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN
        );
      return;
    }

    const folderIdentifier =
      storageProvider === "googledrive"
        ? exp_data.driveFolderId
        : exp_data.dropboxFolder;

    console.log(`Listing sessions from ${storageProvider}:`, {
      folderIdentifier,
      experimentID,
    });

    const result = await listSessions(
      storageProvider,
      tokenResult.access_token,
      folderIdentifier,
      experimentID
    );

    console.log(`${storageProvider} list result:`, result);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message: result.errorText || "Error listing sessions",
      });
      return;
    }

    res.status(200).json({
      success: true,
      sessions: result.sessions,
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

/**
 * Función auxiliar para descargar sesión como CSV
 */
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
    const storageProvider = exp_data.storageProvider || "googledrive";

    const tokenResult = await getValidToken(storageProvider, exp_data.owner);

    if (!tokenResult.success) {
      res
        .status(400)
        .json(
          storageProvider === "dropbox"
            ? MESSAGES.INVALID_DROPBOX_TOKEN
            : MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN
        );
      return;
    }

    const folderIdentifier =
      storageProvider === "googledrive"
        ? exp_data.driveFolderId
        : exp_data.dropboxFolder;

    console.log(`Downloading session from ${storageProvider}:`, {
      folderIdentifier,
      experimentID,
      sessionId,
    });

    const result = await downloadSession(
      storageProvider,
      tokenResult.access_token,
      folderIdentifier,
      experimentID,
      sessionId
    );

    console.log(`${storageProvider} download result:`, result);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message:
          result.errorText || result.error || "Error downloading session",
      });
      return;
    }

    // Enviar el CSV como respuesta
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${experimentID}_${sessionId}.csv"`
    );
    res.status(200).send(result.csv);
  } catch (error) {
    console.error("Error in handleDownloadSession:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
}

/**
 * Función auxiliar para eliminar sesión
 */
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
    const storageProvider = exp_data.storageProvider || "googledrive";

    const tokenResult = await getValidToken(storageProvider, exp_data.owner);

    if (!tokenResult.success) {
      res
        .status(400)
        .json(
          storageProvider === "dropbox"
            ? MESSAGES.INVALID_DROPBOX_TOKEN
            : MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN
        );
      return;
    }

    const folderIdentifier =
      storageProvider === "googledrive"
        ? exp_data.driveFolderId
        : exp_data.dropboxFolder;

    console.log(`Deleting session from ${storageProvider}:`, {
      folderIdentifier,
      experimentID,
      sessionId,
    });

    const result = await deleteSession(
      storageProvider,
      tokenResult.access_token,
      folderIdentifier,
      experimentID,
      sessionId
    );

    console.log(`${storageProvider} delete result:`, result);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message: result.errorText || "Error deleting session",
      });
      return;
    }

    // Decrementar el contador de sesiones en Firestore
    await exp_doc_ref.set(
      { sessions: FieldValue.increment(-1) },
      { merge: true }
    );

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
