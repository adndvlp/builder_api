import { onRequest } from "firebase-functions/v2/https";
import { onValueWritten } from "firebase-functions/v2/database";
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
import { createExperimentDropbox } from "./api-create-experiment-dropbox.js";
import { Parser } from "json2csv";

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
      const result = await finalizeSessionDropbox(experimentID, sessionId);
      res.status(200).json(result);
    } catch (error) {
      console.error("Error in finish action:", error);

      // Mapear errores a respuestas HTTP apropiadas
      if (error.message === "EXPERIMENT_NOT_FOUND") {
        res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
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
          message: "No results to send to Dropbox",
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Internal server error",
          error: error.message,
        });
      }
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
    let exp_doc = await exp_doc_ref.get();

    // Si no existe el experimento, créalo directamente aquí
    if (!exp_doc.exists) {
      await exp_doc_ref.set(
        {
          title: experimentID,
          owner: req.body.uid || "unknown",
          active: true,
          sessions: 0,
          dropboxFolder: null,
          // ...otros campos necesarios
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

    // Si error 404 o 400, crear experimento completo usando la función dedicada
    if (
      !result.success &&
      (result.errorCode === 404 || result.errorCode === 400)
    ) {
      try {
        console.log("Creating experiment using createExperimentDropbox");

        // Usar la función de creación de experimento para Dropbox
        const createResult = await createExperimentDropbox(
          experimentID,
          experimentID, // Usar experimentID como nombre si no se proporciona
          req.body.uid || "unknown"
        );

        console.log("Experiment creation result:", createResult);

        // Obtener los datos actualizados del experimento
        const updated_exp_doc = await exp_doc_ref.get();
        const updated_exp_data = updated_exp_doc.data();

        // Reintentar crear la sesión con los datos actualizados
        result = await createSessionDropbox(
          updated_exp_data.dropboxFolder,
          tokenResult.access_token,
          experimentID,
          sessionId
        );
        console.log("Retry Dropbox creation result:", result);
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

// Función auxiliar para agregar resultado (ahora guarda en Firestore temporalmente)
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

// Función auxiliar INTERNA para finalizar sesión en Dropbox (lógica pura sin req/res)
export async function finalizeSessionDropbox(experimentID, sessionId) {
  await writeLog(experimentID, "finishSessionDropbox");

  const exp_doc_ref = db.collection("experiments").doc(experimentID);
  const exp_doc = await exp_doc_ref.get();

  if (!exp_doc.exists) {
    throw new Error("EXPERIMENT_NOT_FOUND");
  }

  const exp_data = exp_doc.data();

  // Obtener token válido de Dropbox
  const tokenResult = await getValidDropboxToken(exp_data.owner);

  if (!tokenResult.success) {
    throw new Error("INVALID_DROPBOX_TOKEN");
  }

  console.log("Finishing session - fetching results from Firestore:", {
    experimentID,
    sessionId,
  });

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

  console.log(`Sending ${results.length} results to Dropbox in batch`);

  // Crear la sesión en Dropbox si no existe
  const createResult = await createSessionDropbox(
    exp_data.dropboxFolder,
    tokenResult.access_token,
    experimentID,
    sessionId
  );

  // Si la sesión ya existe (409), continuamos de todas formas
  if (
    !createResult.success &&
    createResult.error !== "Session already exists"
  ) {
    throw new Error(
      createResult.errorText || "Error creating session in Dropbox"
    );
  }

  // Extraer todos los campos únicos de los resultados
  const allFields = Array.from(
    new Set(results.flatMap((row) => Object.keys(row)))
  );
  // Convertir a CSV con json2csv usando los campos detectados
  const parser = new Parser({ fields: allFields });
  let finalCSV;
  try {
    finalCSV = parser.parse(results);
  } catch (err) {
    throw new Error("Error converting results to CSV: " + err.message);
  }

  // Subir el CSV final a Dropbox (sobrescribir)
  const uploadResult = await appendResultDropbox(
    exp_data.dropboxFolder,
    tokenResult.access_token,
    experimentID,
    sessionId,
    finalCSV,
    true // overwrite mode
  );
  if (!uploadResult.success) {
    throw new Error(
      uploadResult.errorText || "Error uploading final CSV to Dropbox"
    );
  }

  // Limpiar los datos temporales de Firestore
  await session_ref.delete();

  console.log("Session finished and cleaned up successfully");

  return {
    success: true,
    message: "Session finished successfully",
    resultsSent: results.length,
  };
}

// Cloud Function para finalizar sesiones desconectadas automáticamente en Dropbox
// Se dispara cuando se actualiza un nodo en /sessions/{experimentID}/{sessionId}
export const finalizeDisconnectedSessionsDropbox = onValueWritten(
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
    // SOLO procesar si storage es 'dropbox'
    if (afterData.storage !== "dropbox") {
      console.log(
        "Skip finalization: storage is not dropbox",
        afterData.storage
      );
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

    console.log(
      `Processing session finalization: ${experimentID}/${sessionId}`,
      `finished: ${
        afterData.finished || false
      }, disconnected: ${!afterData.connected}`
    );

    try {
      // Usar la función unificada
      const result = await finalizeSessionDropbox(experimentID, sessionId);

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

    // Enviar el CSV como respuesta (igual que Drive)
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
