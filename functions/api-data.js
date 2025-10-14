import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import validateCSV from "./validate-csv.js";
import validateJSON from "./validate-json.js";
import postFileGoogleDrive, {
  createSessionGoogleDrive,
  appendResultGoogleDrive,
  listSessionsGoogleDrive,
  downloadSessionGoogleDrive,
  deleteSessionGoogleDrive,
} from "./crud-file-google-drive.js";
import getValidGoogleDriveToken from "./refresh-google-drive-token.js";

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
    return await handleFinishSession(req, res, experimentID, sessionId);
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

  // Obtener token válido de Google Drive (refresca automáticamente si es necesario)
  const tokenResult = await getValidGoogleDriveToken(exp_data.owner);

  if (!tokenResult.success) {
    res.status(400).json(MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN);
    return;
  }

  const result = await postFileGoogleDrive(
    exp_data.driveFolderId,
    tokenResult.access_token,
    data,
    filename
  );

  if (!result.success) {
    if (result.errorCode === 409) {
      res.status(409).json(MESSAGES.FILE_ALREADY_EXISTS);
      return;
    }
    res.status(400).json(MESSAGES.GOOGLE_DRIVE_UPLOAD_ERROR);
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
        res.status(400).json(MESSAGES.MAX_SESSIONS_REACHED);
        return;
      }
    }

    // Obtener token válido de Google Drive (refresca automáticamente si es necesario)
    const tokenResult = await getValidGoogleDriveToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN);
      return;
    }

    console.log("Creating session in Google Drive:", {
      folderId: exp_data.driveFolderId,
      experimentID,
      sessionId,
    });

    // Crear la sesión en Google Drive
    const result = await createSessionGoogleDrive(
      exp_data.driveFolderId,
      tokenResult.access_token,
      experimentID,
      sessionId
    );

    console.log("Google Drive creation result:", result);

    if (!result.success) {
      if (result.errorCode === 409) {
        res.status(409).json({
          success: false,
          message: "Session already exists",
          errorCode: 409,
        });
        return;
      }
      res.status(400).json({
        success: false,
        message: result.errorText || "Error creating session",
      });
      return;
    }

    // Calcular el número de participante listando todas las sesiones
    const sessionsResult = await listSessionsGoogleDrive(
      exp_data.driveFolderId,
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

    // Parsear data si viene como string
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

    console.log("Appending result to Firestore temporarily:", {
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
      // Crear la sesión si no existe
      await session_ref.set({
        createdAt: FieldValue.serverTimestamp(),
        results: [parsedData],
      });
    } else {
      // Agregar al array de resultados
      await session_ref.update({
        results: FieldValue.arrayUnion(parsedData),
      });
    }

    console.log("Result appended to Firestore successfully");

    res.status(201).json({
      success: true,
      message: "Result appended successfully to temporary storage",
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

// Función auxiliar para finalizar sesión (enviar a Google Drive y limpiar Firestore)
async function handleFinishSession(req, res, experimentID, sessionId) {
  try {
    await writeLog(experimentID, "finishSession");

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();

    if (!exp_doc.exists) {
      res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
      return;
    }

    const exp_data = exp_doc.data();

    // Obtener token válido de Google Drive
    const tokenResult = await getValidGoogleDriveToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN);
      return;
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
      res.status(400).json({
        success: false,
        message: "Session not found in temporary storage",
      });
      return;
    }

    const session_data = session_doc.data();
    const results = session_data.results || [];

    if (results.length === 0) {
      res.status(400).json({
        success: false,
        message: "No results to send to Google Drive",
      });
      return;
    }

    console.log(`Sending ${results.length} results to Google Drive in batch`);

    // Crear la sesión en Google Drive si no existe
    const createResult = await createSessionGoogleDrive(
      exp_data.driveFolderId,
      tokenResult.access_token,
      experimentID,
      sessionId
    );

    // Si la sesión ya existe (409), continuamos de todas formas
    if (!createResult.success && createResult.errorCode !== 409) {
      res.status(400).json({
        success: false,
        message: createResult.errorText || "Error creating session in Drive",
      });
      return;
    }

    // Enviar todos los resultados a Google Drive
    let failedCount = 0;
    for (const result of results) {
      const appendResult = await appendResultGoogleDrive(
        exp_data.driveFolderId,
        tokenResult.access_token,
        experimentID,
        sessionId,
        result
      );

      if (!appendResult.success) {
        failedCount++;
        console.error("Failed to append result:", appendResult.errorText);
      }
    }

    if (failedCount > 0) {
      res.status(400).json({
        success: false,
        message: `Failed to send ${failedCount} of ${results.length} results to Google Drive`,
      });
      return;
    }

    console.log("All results sent to Google Drive, cleaning up Firestore");

    // Limpiar los datos temporales de Firestore
    await session_ref.delete();

    console.log("Session finished and cleaned up successfully");

    res.status(200).json({
      success: true,
      message: "Session finished successfully",
      resultsSent: results.length,
    });
  } catch (error) {
    console.error("Error in handleFinishSession:", error);
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

    // Obtener token válido de Google Drive (refresca automáticamente si es necesario)
    const tokenResult = await getValidGoogleDriveToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN);
      return;
    }

    console.log("Listing sessions from Google Drive:", {
      folderId: exp_data.driveFolderId,
      experimentID,
    });

    // Listar las sesiones
    const result = await listSessionsGoogleDrive(
      exp_data.driveFolderId,
      tokenResult.access_token,
      experimentID
    );

    console.log("Google Drive list result:", result);

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

    // Obtener token válido de Google Drive (refresca automáticamente si es necesario)
    const tokenResult = await getValidGoogleDriveToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN);
      return;
    }

    console.log("Downloading session from Google Drive:", {
      folderId: exp_data.driveFolderId,
      experimentID,
      sessionId,
    });

    // Descargar la sesión
    const result = await downloadSessionGoogleDrive(
      exp_data.driveFolderId,
      tokenResult.access_token,
      experimentID,
      sessionId
    );

    console.log("Google Drive download result:", result);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message: result.errorText || "Error downloading session",
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

    // Obtener token válido de Google Drive (refresca automáticamente si es necesario)
    const tokenResult = await getValidGoogleDriveToken(exp_data.owner);

    if (!tokenResult.success) {
      res.status(400).json(MESSAGES.INVALID_GOOGLE_DRIVE_TOKEN);
      return;
    }

    console.log("Deleting session from Google Drive:", {
      folderId: exp_data.driveFolderId,
      experimentID,
      sessionId,
    });

    // Eliminar la sesión
    const result = await deleteSessionGoogleDrive(
      exp_data.driveFolderId,
      tokenResult.access_token,
      experimentID,
      sessionId
    );

    console.log("Google Drive delete result:", result);

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
