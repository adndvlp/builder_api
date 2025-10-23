import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import fetch from "node-fetch";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import { getAuth } from "firebase-admin/auth";
import { createFolderDropbox } from "./crud-file-dropbox.js";
import getValidDropboxToken from "./refresh-dropbox-token.js";

export const apiCreateExperiment = onRequest(
  { cors: true },
  async (req, res) => {
    // Validar parámetros requeridos
    const { experimentID, experimentName, uid } = req.body;

    if (!experimentID || !experimentName) {
      res.status(400).json({
        success: false,
        message: "Missing required parameters: experimentID or experimentName",
      });
      return;
    }

    await writeLog(experimentID, "createExperiment");

    try {
      // Crear la ruta de la carpeta en Dropbox usando el nombre del experimento
      const folderPath = `/ExpBuilder/${experimentName}`;

      // Obtener el token de Dropbox del usuario si se proporciona uid
      let dropboxFolderCreated = false;
      let dropboxError = null;

      if (uid) {
        try {
          // Obtener token válido de Dropbox (refresca automáticamente si es necesario)
          const tokenResult = await getValidDropboxToken(uid);

          if (tokenResult.success) {
            // Crear la carpeta en Dropbox
            const dropboxResult = await createFolderDropbox(
              tokenResult.access_token,
              folderPath
            );

            if (dropboxResult.success) {
              dropboxFolderCreated = true;
            } else {
              dropboxError = dropboxResult.errorText;
              console.error("Error creating Dropbox folder:", dropboxError);
            }
          } else {
            dropboxError = `Token error: ${tokenResult.error}`;
            console.error(
              "Error getting valid Dropbox token:",
              tokenResult.error
            );
          }
        } catch (error) {
          console.error("Error accessing user data or creating folder:", error);
          dropboxError = error.message;
        }
      }

      // Guardar experimento en Firestore con el ID recibido y el owner si se proporciona
      const experimentRef = db.collection("experiments").doc(experimentID);
      await experimentRef.set({
        title: experimentName,
        dropboxFolder: folderPath,
        active: true, // Activo por defecto para permitir colección de datos
        activeBase64: false,
        activeConditionAssignment: false,
        sessions: 0,
        limitSessions: false,
        maxSessions: 1,
        id: experimentID,
        nConditions: 1,
        currentCondition: 0,
        useValidation: true,
        allowJSON: true,
        allowCSV: true,
        requiredFields: ["trial_type"],
        createdAt: FieldValue.serverTimestamp(),
        ...(uid && { owner: uid }),
      });

      res.status(201).json({
        success: true,
        message: "Experiment created successfully",
        experimentID: experimentID,
        dropboxFolder: folderPath,
        dropboxFolderCreated: dropboxFolderCreated,
        ...(dropboxError && { dropboxError }),
      });
    } catch (error) {
      console.error("Error creating experiment:", error);
      res.status(500).json({
        success: false,
        message: `Internal server error: ${error.message}`,
      });
    }
  }
);
