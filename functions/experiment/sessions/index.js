import { onRequest } from "firebase-functions/v2/https";
import { onValueWritten } from "firebase-functions/v2/database";
import { FieldValue } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";
import { app, db } from "../../app.js";
import writeLog from "./write-log.js";
import MESSAGES from "../api-messages.js";
import validateCSV from "./validate-csv.js";
import validateJSON from "./validate-json.js";
import { Parser } from "json2csv";
import { getValidToken } from "../../oauth/index.js";
import { createSession, appendResult, postFile } from "./storage.js";
import {
  handleCreateSession,
  handleAppendResult,
  handleListSessions,
  handleDownloadSession,
  handleDeleteSession,
} from "./session-handler.js";

/**
 * Deserializa datos desde Firestore, convirtiendo JSON strings de vuelta a arrays/objetos
 */
function deserializeFromFirestore(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Si es un objeto
  if (typeof obj === "object" && !Array.isArray(obj)) {
    const deserialized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Si es un string que parece JSON, intentar parsearlo
      if (
        typeof value === "string" &&
        (value.startsWith("[") || value.startsWith("{"))
      ) {
        try {
          deserialized[key] = JSON.parse(value);
        } catch {
          // Si falla el parse, mantener como string
          deserialized[key] = value;
        }
      } else if (typeof value === "object") {
        deserialized[key] = deserializeFromFirestore(value);
      } else {
        deserialized[key] = value;
      }
    }
    return deserialized;
  }

  return obj;
}

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
 * Endpoint para enviar experimento completo directo al storage (sin Firestore)
 * Usado cuando batchSize = 0 (enviar todo al final)
 */
export const apiDataComplete = onRequest({ cors: true }, async (req, res) => {
  const { experimentID, sessionId, trialsData, storage } = req.body;

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
          : exp_data.osfUploadLink;

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

    res.status(201).json({
      success: true,
      message: "Complete experiment saved successfully to storage",
      storageProvider,
    });
  } catch (error) {
    console.error("Error in apiDataComplete:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
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
        : "INVALID_GOOGLE_DRIVE_TOKEN",
    );
  }

  console.log("Finishing session - fetching results from Firestore:", {
    experimentID,
    sessionId,
  });

  // Leer el estado desde Firebase Realtime Database
  let sessionState = null;
  try {
    const rtdb = getDatabase(app);
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

  // Obtener sesión y trials de Firestore
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

  // Leer TODOS los trials de la subcolección
  const trials_snapshot = await session_ref.collection("trials").get();

  if (trials_snapshot.empty) {
    throw new Error("NO_RESULTS");
  }

  // Convertir a array y expandir batches concatenados
  let results = [];

  trials_snapshot.docs.forEach((doc) => {
    const data = doc.data();

    // Si es un batch concatenado (tiene trialsData como string JSON)
    if (data.trialsData && typeof data.trialsData === "string") {
      try {
        const batchTrials = JSON.parse(data.trialsData);
        if (Array.isArray(batchTrials)) {
          // Deserializar cada trial del batch
          const deserializedTrials = batchTrials.map((trial) =>
            deserializeFromFirestore(trial),
          );
          results = results.concat(deserializedTrials);
          console.log(`Expanded batch with ${batchTrials.length} trials`);
        }
      } catch (err) {
        console.error("Error parsing batch trialsData:", err);
      }
    } else {
      // Trial individual normal
      results.push(deserializeFromFirestore(data));
    }
  });

  if (results.length === 0) {
    throw new Error("NO_RESULTS");
  }

  // ORDENAR por clientTimestamp del cliente
  results.sort((a, b) => {
    const timeA = a.clientTimestamp || 0;
    const timeB = b.clientTimestamp || 0;
    return timeA - timeB;
  });

  console.log(`Retrieved ${results.length} trials, ordered by clientTimestamp`);

  // Agregar metadata a cada fila (igual que en la app local)
  const metadata = session_data.metadata || {};
  const createdAt = session_data.createdAt || new Date().toISOString();

  const dataWithMetadata = results.map((row) => ({
    ...row,
    // Agregar campos de metadata
    session_browser: metadata.browser || "",
    session_browser_version: metadata.browserVersion || "",
    session_os: metadata.os || "",
    session_screen_resolution: metadata.screenResolution || "",
    session_language: metadata.language || "",
    session_started_at: metadata.startedAt || "",
    session_id: sessionId,
    session_created_at: createdAt,
    session_state: sessionState || session_data.state || "",
  }));

  // Extraer todos los campos únicos de los resultados (ahora incluye metadata)
  const allFields = Array.from(
    new Set(dataWithMetadata.flatMap((row) => Object.keys(row))),
  );

  // Convertir a CSV con json2csv usando los campos detectados
  const parser = new Parser({ fields: allFields });
  let finalCsv;
  try {
    finalCsv = parser.parse(dataWithMetadata);
  } catch (err) {
    throw new Error("Error converting results to CSV: " + err.message);
  }

  console.log(
    `Final CSV to send to ${storageProvider} (with metadata):\n${finalCsv}`,
  );

  const folderIdentifier =
    storageProvider === "googledrive"
      ? exp_data.driveFolderId
      : storageProvider === "dropbox"
        ? exp_data.dropboxFolder
        : exp_data.osfUploadLink;

  // Determinar si debe usar PATCH o CREATE+APPEND
  // Drive y Dropbox SIEMPRE usan PATCH (descargar → concatenar → sobrescribir)
  // OSF usa append directo (no PATCH)
  const isPatchMode =
    storageProvider === "googledrive" || storageProvider === "dropbox";

  let fileExists = false;
  let existingCsvContent = "";

  if (isPatchMode) {
    // Verificar si el archivo ya existe y obtener contenido
    const fileName = `${experimentID}_${sessionId}.csv`;

    if (storageProvider === "googledrive") {
      // Buscar archivo en Drive
      const searchQuery = `name='${fileName}' and '${folderIdentifier}' in parents and trashed=false`;
      const searchResult = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQuery)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tokenResult.access_token}` },
        },
      );

      const searchData = await searchResult.json();
      if (searchData.files && searchData.files.length > 0) {
        fileExists = true;
        const fileId = searchData.files[0].id;

        // Descargar contenido existente
        const downloadResult = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${tokenResult.access_token}` },
          },
        );

        if (downloadResult.ok) {
          existingCsvContent = await downloadResult.text();
          console.log(
            `Drive: Found existing file with ${existingCsvContent.split("\n").length} lines`,
          );
        }
      }
    } else if (storageProvider === "dropbox") {
      // Verificar en Dropbox
      const filePath = `${folderIdentifier}/${fileName}`;
      const checkResult = await fetch(
        "https://content.dropboxapi.com/2/files/download",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenResult.access_token}`,
            "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
          },
        },
      );

      if (checkResult.status === 200) {
        fileExists = true;
        existingCsvContent = await checkResult.text();
        console.log(
          `Dropbox: Found existing file with ${existingCsvContent.split("\n").length} lines`,
        );
      }
    }

    // Si existe, concatenar nuevo CSV (sin headers duplicados)
    if (fileExists && existingCsvContent) {
      const existingLines = existingCsvContent.split("\n");
      const newLines = finalCsv.split("\n");

      // Saltar header del nuevo CSV (primera línea)
      const dataLines = newLines.slice(1);

      // Concatenar: contenido existente + nuevas líneas de datos
      finalCsv = existingLines.join("\n") + "\n" + dataLines.join("\n");

      console.log(
        `PATCH mode: Appended ${dataLines.length} new lines to existing ${existingLines.length} lines`,
      );
    } else {
      // No existe: crear archivo nuevo
      const createResult = await createSession(
        storageProvider,
        tokenResult.access_token,
        folderIdentifier,
        experimentID,
        sessionId,
      );

      if (!createResult.success && createResult.errorCode !== 409) {
        throw new Error(
          createResult.errorText ||
            createResult.error ||
            `Error creating session in ${storageProvider}`,
        );
      }

      console.log(`PATCH mode: Created new file for session ${sessionId}`);
    }
  } else {
    // Modo normal: crear sesión si no existe
    const createResult = await createSession(
      storageProvider,
      tokenResult.access_token,
      folderIdentifier,
      experimentID,
      sessionId,
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
          `Error creating session in ${storageProvider}`,
      );
    }
  }

  // Enviar el CSV final al storage
  const appendResult_ = await appendResult(
    storageProvider,
    tokenResult.access_token,
    folderIdentifier,
    experimentID,
    sessionId,
    finalCsv,
  );

  if (!appendResult_.success) {
    throw new Error(
      appendResult_.errorText || `Failed to send results to ${storageProvider}`,
    );
  }

  console.log(
    `All results sent to ${storageProvider}`,
    fileExists ? "(PATCH to existing file)" : "(new file)",
  );

  // Limpiar los datos temporales de Firestore (documento de sesión + subcolección trials)
  // Primero borrar todos los trials de la subcolección
  const trialsSnapshot = await session_ref.collection("trials").get();
  const batch = db.batch();

  trialsSnapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  // Luego borrar el documento de la sesión
  batch.delete(session_ref);

  await batch.commit();

  console.log(
    `Session ${sessionId} finished and cleaned up successfully (${trialsSnapshot.size} trials deleted)`,
  );

  return {
    success: true,
    message: "Session finished successfully",
    resultsSent: results.length,
    fileExists: fileExists,
    patchMode: isPatchMode,
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

    const experimentID = event.params.experimentID;
    const sessionId = event.params.sessionId;
    const wasConnected = beforeData?.connected === true;
    const isNowDisconnected = afterData.connected === false;
    const useIndexedDB = afterData.useIndexedDB !== false; // Por defecto true

    // CASO 1: Sesión SIN IndexedDB - manejar según storage provider (SIEMPRE con retoma)
    if (isNowDisconnected && wasConnected && !useIndexedDB) {
      const state = afterData.state;
      const storageProvider = afterData.storageProvider || "googledrive";

      // Si se desconectó pero NO finalizó
      if (state === "disconnected" && !afterData.finished) {
        console.log(
          `Session ${sessionId} disconnected without IndexedDB. Provider: ${storageProvider}`,
        );

        if (storageProvider === "osf") {
          // OSF: Iniciar contador de timeout
          console.log(
            `OSF provider: Starting timeout for session ${sessionId}...`,
          );

          const timeoutMinutes = afterData.resumeTimeoutMinutes || 30;
          const timeoutMs = timeoutMinutes * 60 * 1000;
          const expiresAt = Date.now() + timeoutMs;

          await event.data.after.ref.update({
            resumeExpiresAt: expiresAt,
            resumeTimeoutStarted: Date.now(),
          });

          // Programar limpieza después del timeout
          setTimeout(async () => {
            const currentSnapshot = await event.data.after.ref.once("value");
            const currentData = currentSnapshot.val();

            if (!currentData) return;

            // Si sigue desconectada y no se reconectó, enviar a OSF y limpiar
            if (
              currentData.connected === false &&
              currentData.state === "disconnected"
            ) {
              console.log(
                `OSF session ${sessionId} timeout expired. Sending to OSF and cleaning up...`,
              );

              try {
                // Enviar a OSF y eliminar de Firestore
                await finalizeSession(experimentID, sessionId);

                await event.data.after.ref.update({
                  state: "expired",
                  finalizationProcessed: true,
                  expiredAt: Date.now(),
                });
              } catch (err) {
                console.error(
                  `Error finalizing OSF session ${sessionId}:`,
                  err,
                );
              }
            }
          }, timeoutMs);
        } else {
          // Drive/Dropbox: PATCH inmediato al desconectar
          console.log(
            `${storageProvider} provider: Sending PATCH immediately for session ${sessionId}...`,
          );

          try {
            // Enviar lo acumulado hasta ahora (PATCH o CREATE si no existe)
            // finalizeSession ya limpia Firestore automáticamente
            await finalizeSession(experimentID, sessionId);

            await event.data.after.ref.update({
              state: "partially_saved",
              lastPatchAt: Date.now(),
              finalizationProcessed: false, // Permitir otro envío si retoma
            });

            console.log(
              `Session ${sessionId} data sent to ${storageProvider} and Firestore cleaned`,
            );
          } catch (err) {
            console.error(`Error sending PATCH for ${sessionId}:`, err);

            // Marcar error pero no bloquear retoma
            await event.data.after.ref.update({
              lastPatchError: err.message,
              lastPatchErrorAt: Date.now(),
            });
          }
        }

        return null;
      }

      // Si se reconectó (OSF), cancelar timeout
      if (
        afterData.connected === true &&
        beforeData?.connected === false &&
        storageProvider === "osf"
      ) {
        console.log(`OSF session ${sessionId} reconnected. Canceling timeout.`);

        await event.data.after.ref.update({
          state: "resumed",
          resumedAt: Date.now(),
          resumeExpiresAt: null,
          resumeTimeoutStarted: null,
        });

        return null;
      }
    }

    // CASO 2: Sesión CON IndexedDB - manejar timeout (SIEMPRE con retoma)
    if (isNowDisconnected && wasConnected && useIndexedDB) {
      const state = afterData.state;

      // Si se desconectó pero NO finalizó, iniciar contador de timeout
      if (state === "disconnected" && !afterData.finished) {
        console.log(
          `Session ${sessionId} disconnected with resume enabled (IndexedDB). Starting timeout...`,
        );

        // Calcular tiempo de expiración
        const timeoutMinutes = afterData.resumeTimeoutMinutes || 30;
        const timeoutMs = timeoutMinutes * 60 * 1000;
        const expiresAt = Date.now() + timeoutMs;

        // Actualizar con tiempo de expiración
        await event.data.after.ref.update({
          resumeExpiresAt: expiresAt,
          resumeTimeoutStarted: Date.now(),
        });

        // Programar limpieza después del timeout
        setTimeout(async () => {
          // Verificar si la sesión sigue desconectada
          const currentSnapshot = await event.data.after.ref.once("value");
          const currentData = currentSnapshot.val();

          if (!currentData) return; // Ya fue eliminada

          // Si sigue desconectada y no se reconectó, limpiar
          if (
            currentData.connected === false &&
            currentData.state === "disconnected"
          ) {
            console.log(`Session ${sessionId} timeout expired. Cleaning up...`);

            // Eliminar datos de Firestore
            try {
              const session_ref = db
                .collection("experiments")
                .doc(experimentID)
                .collection("sessions")
                .doc(sessionId);

              await session_ref.delete();
              console.log(
                `Firestore data deleted for expired session ${sessionId}`,
              );
            } catch (err) {
              console.error(
                `Error deleting Firestore data for ${sessionId}:`,
                err,
              );
            }

            // Marcar en Realtime DB como expirado y procesado
            await event.data.after.ref.update({
              state: "expired",
              finalizationProcessed: true,
              expiredAt: Date.now(),
            });
          }
        }, timeoutMs);

        return null;
      }

      // Si se reconectó, cancelar timeout
      if (afterData.connected === true && beforeData?.connected === false) {
        console.log(`Session ${sessionId} reconnected. Canceling timeout.`);

        await event.data.after.ref.update({
          state: "resumed",
          resumedAt: Date.now(),
          resumeExpiresAt: null,
          resumeTimeoutStarted: null,
        });

        return null;
      }
    }

    // CASO 3: Finalización normal
    // Solo procesar si needsFinalization está en true
    if (afterData.needsFinalization !== true) {
      return null;
    }

    // IMPORTANTE: Solo procesar si cambió de connected=true a connected=false
    if (!wasConnected || !isNowDisconnected) {
      return null;
    }

    const isAbandoned = afterData.state === "abandoned";

    console.log(
      `Processing session finalization: ${experimentID}/${sessionId}`,
      `finished: ${
        afterData.finished || false
      }, disconnected: ${!afterData.connected}, state: ${
        afterData.state || "unknown"
      }`,
    );

    try {
      // Si fue abandonado, guardar estado en db.json local
      if (isAbandoned && afterData.metadata) {
        console.log(
          `Session ${sessionId} marked as abandoned with metadata:`,
          afterData.metadata,
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
  },
);

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
