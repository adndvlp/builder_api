import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../app.js";
import writeLog from "./write-log.js";
import MESSAGES from "../api-messages.js";
import validateJSON from "./validate-json.js";
import { getValidToken } from "../../oauth/index.js";
import { listSessions, downloadSession, deleteSession } from "./storage.js";

/**
 * Sanitiza datos para Firestore, convirtiendo arrays/objetos anidados problemáticos
 * Firestore no permite arrays anidados, así que los convertimos recursivamente
 */
function sanitizeForFirestore(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Si es un array
  if (Array.isArray(obj)) {
    // Verificar si contiene arrays u objetos anidados
    const hasNestedStructures = obj.some(
      (item) =>
        Array.isArray(item) || (typeof item === "object" && item !== null),
    );

    // Si tiene estructuras anidadas, convertir a JSON string
    if (hasNestedStructures) {
      return JSON.stringify(obj);
    }

    // Si solo tiene valores primitivos, mantener como array
    return obj;
  }

  // Si es un objeto
  if (typeof obj === "object") {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeForFirestore(value);
    }
    return sanitized;
  }

  // Valores primitivos (string, number, boolean)
  return obj;
}

/**
 * Función auxiliar para crear sesión
 * Obtiene el número de participante desde el contador de condiciones y lo retorna
 */
async function handleCreateSession(req, res, experimentID, sessionId) {
  try {
    await writeLog(experimentID, "createSession");

    const { batchSize } = req.body;
    console.log(
      `[CREATE SESSION] batchSize received: ${batchSize} (type: ${typeof batchSize})`,
    );

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    let exp_doc = await exp_doc_ref.get();

    // Si no existe el experimento, retornar error (ya no se crea automáticamente aquí)
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

    // Verificar si la sesión ya existe en Firestore (resume)
    const session_ref = db
      .collection("experiments")
      .doc(experimentID)
      .collection("sessions")
      .doc(sessionId);

    const existing_session = await session_ref.get();

    if (existing_session.exists) {
      // Sesión existente (resume) - devolver participantNumber guardado
      const session_data = existing_session.data();
      console.log("Session already exists (resume):", {
        experimentID,
        sessionId,
        participantNumber: session_data.participantNumber,
      });

      res.status(200).json({
        success: true,
        message: "Session resumed successfully",
        sessionId: sessionId,
        participantNumber: session_data.participantNumber,
      });
      return;
    }

    // Obtener número de participante desde el contador de condiciones
    let participantNumber;
    try {
      if (!exp_data.activeConditionAssignment) {
        res.status(400).json(MESSAGES.CONDITION_ASSIGNMENT_NOT_ACTIVE);
        return;
      }

      // Usar transacción para incremento atómico
      participantNumber = await db.runTransaction(async (t) => {
        const exp_doc = await t.get(exp_doc_ref);
        const exp_data = exp_doc.data();
        const currentCondition = exp_data.currentCondition || 0;

        // Si nConditions > 1, rotar con módulo. Si nConditions === 1, incrementar sin límite
        const nextCondition =
          exp_data.nConditions > 1
            ? (currentCondition + 1) % exp_data.nConditions
            : currentCondition + 1;

        t.set(
          exp_doc_ref,
          { currentCondition: nextCondition },
          { merge: true },
        );
        return currentCondition;
      });
    } catch (error) {
      console.error("Error getting condition:", error);
      res.status(400).json(MESSAGES.UNKNOWN_ERROR_GETTING_CONDITION);
      return;
    }

    console.log("Session registered with participant number:", {
      experimentID,
      sessionId,
      participantNumber,
      batchSize,
    });

    // Si batchSize=0, NO crear documento de sesión (solo retornar participantNumber)
    // Los datos se enviarán directo al storage sin pasar por Firestore
    // Validar explícitamente que batchSize es 0 (no undefined, null, etc.)
    const shouldCreateSessionDoc =
      batchSize !== 0 && batchSize !== undefined && batchSize !== null;

    if (shouldCreateSessionDoc) {
      console.log(
        `[CREATE SESSION] Creating Firestore document (batchSize=${batchSize})`,
      );
      // Crear documento de sesión en Firestore (para batch>0 o sin IndexedDB)
      await session_ref.set({
        experimentID: experimentID,
        sessionId: sessionId,
        participantNumber: participantNumber,
        createdAt: new Date().toISOString(),
      });
    } else {
      console.log(
        `[CREATE SESSION] Skipping Firestore document creation (batchSize=${batchSize})`,
      );
    }

    // Incrementar contador de sesiones en Firestore
    await exp_doc_ref.set(
      { sessions: FieldValue.increment(1) },
      { merge: true },
    );

    res.status(201).json({
      success: true,
      message: "Session registered successfully",
      sessionId: sessionId,
      participantNumber: participantNumber,
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

    // Detectar si es un batch concatenado (tiene trialsData como string JSON)
    const isBatchConcatenated =
      parsedData.trialsData && typeof parsedData.trialsData === "string";

    // Validar los datos si está configurado (SALTAR validación para batches concatenados)
    if (exp_data.useValidation && !isBatchConcatenated) {
      let valid = false;
      if (exp_data.allowJSON) {
        valid = validateJSON(
          JSON.stringify([parsedData]),
          exp_data.requiredFields,
        );
      }
      if (!valid) {
        res.status(400).json(MESSAGES.INVALID_DATA);
        return;
      }
    }

    if (isBatchConcatenated) {
      console.log("Appending BATCH to Firestore temporarily:", {
        experimentID,
        sessionId,
        batchNumber: parsedData.batchNumber,
        trialsCount: parsedData.trialsCount,
      });
    } else {
      console.log("Appending JSON result to Firestore temporarily:", {
        experimentID,
        sessionId,
      });
    }

    // Validar que tenga clientTimestamp (solo para trials individuales)
    if (!isBatchConcatenated && !parsedData.clientTimestamp) {
      console.warn(
        "Trial data missing clientTimestamp, adding server timestamp",
      );
      parsedData.clientTimestamp = Date.now();
    }

    // Extraer trial_index y clientTimestamp para crear ID único
    let trialId;

    if (isBatchConcatenated) {
      // Para batches concatenados, usar batchNumber como ID
      trialId = `batch_${parsedData.batchNumber}_${parsedData.firstTrialIndex || 0}`;
    } else {
      // Para trials individuales, usar timestamp + trial_index
      const trialIndex = parsedData.trial_index;
      const clientTimestamp = parsedData.clientTimestamp;
      trialId = `${clientTimestamp}_${trialIndex}`;
    }

    // Serializar datos para Firestore (convierte arrays/objetos anidados problemáticos)
    const sanitizedData = sanitizeForFirestore(parsedData);

    // Guardar cada trial como documento separado en subcolección
    const trial_ref = db
      .collection("experiments")
      .doc(experimentID)
      .collection("sessions")
      .doc(sessionId)
      .collection("trials")
      .doc(trialId);

    await trial_ref.set(sanitizedData);

    // Crear/actualizar documento de sesión con metadata
    const session_ref = db
      .collection("experiments")
      .doc(experimentID)
      .collection("sessions")
      .doc(sessionId);

    const session_doc = await session_ref.get();
    if (!session_doc.exists) {
      await session_ref.set({
        createdAt: FieldValue.serverTimestamp(),
        trialCount: 1,
      });
    } else {
      await session_ref.update({
        trialCount: FieldValue.increment(1),
      });
    }

    console.log(
      isBatchConcatenated
        ? `Batch ${parsedData.batchNumber} saved to Firestore successfully`
        : `Trial ${trialId} saved to Firestore successfully`,
    );

    res.status(201).json({
      success: true,
      message: isBatchConcatenated
        ? "Batch appended successfully to temporary storage"
        : "JSON result appended successfully to temporary storage",
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
          : exp_data.osfUploadLink;

    console.log(`Listing sessions from ${storageProvider}:`, {
      folderIdentifier,
      experimentID,
    });

    const result = await listSessions(
      storageProvider,
      tokenResult.access_token,
      folderIdentifier,
      experimentID,
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
          : exp_data.osfUploadLink;

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
      sessionId,
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
      `attachment; filename="${experimentID}_${sessionId}.csv"`,
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
          : exp_data.osfUploadLink;

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
      sessionId,
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
      { merge: true },
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

export {
  handleCreateSession,
  handleAppendResult,
  handleListSessions,
  handleDownloadSession,
  handleDeleteSession,
};
