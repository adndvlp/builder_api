import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import { createFolderGoogleDrive } from "./crud-file-google-drive.js";
import getValidGoogleDriveToken from "./refresh-google-drive-token.js";

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
      // Crear la ruta de la carpeta en Google Drive usando el nombre del experimento
      const folderPath = `/ExpBuilder/${experimentName}`;

      // Obtener el token de Google Drive del usuario si se proporciona uid
      let driveFolderCreated = false;
      let driveFolderId = null;
      let driveError = null;

      if (uid) {
        try {
          console.log("Getting Google Drive token for user:", uid);
          // Obtener token válido de Google Drive (refresca automáticamente si es necesario)
          const tokenResult = await getValidGoogleDriveToken(uid);
          console.log(
            "Token result:",
            tokenResult.success ? "Success" : "Failed",
            tokenResult.error || ""
          );

          if (tokenResult.success) {
            console.log("Creating folder in Google Drive:", folderPath);
            // Crear la carpeta en Google Drive
            const driveResult = await createFolderGoogleDrive(
              tokenResult.access_token,
              folderPath
            );
            console.log("Drive folder creation result:", driveResult);

            if (driveResult.success) {
              driveFolderCreated = true;
              driveFolderId = driveResult.folderId;
              console.log("Folder created with ID:", driveFolderId);
            } else {
              driveError = driveResult.errorText;
              console.error("Error creating Google Drive folder:", driveError);
            }
          } else {
            driveError = `Token error: ${tokenResult.error}`;
            console.error(
              "Error getting valid Google Drive token:",
              tokenResult.error
            );
          }
        } catch (error) {
          console.error("Error accessing user data or creating folder:", error);
          driveError = error.message;
        }
      }

      // Guardar experimento en Firestore con el ID recibido y el owner si se proporciona
      const experimentRef = db.collection("experiments").doc(experimentID);
      await experimentRef.set({
        title: experimentName,
        driveFolderPath: folderPath,
        driveFolderId: driveFolderId, // Guardar el ID de la carpeta de Google Drive
        storageProvider: "googledrive", // Indicar que usa Google Drive
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
        driveFolderPath: folderPath,
        driveFolderId: driveFolderId,
        driveFolderCreated: driveFolderCreated,
        ...(driveError && { driveError }),
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
