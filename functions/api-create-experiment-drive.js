import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import { createFolderGoogleDrive } from "./crud-file-google-drive.js";
import getValidGoogleDriveToken from "./refresh-google-drive-token.js";

// Función reutilizable para crear experimento en Google Drive (sin req/res)
export async function createExperimentGoogleDrive(
  experimentID,
  experimentName,
  uid
) {
  await writeLog(experimentID, "createExperiment");

  // Crear la ruta de la carpeta en Google Drive usando el nombre del experimento
  const folderPath = `/ExpBuilder/${experimentName}`;

  // Obtener el token de Google Drive del usuario si se proporciona uid
  let driveFolderCreated = false;
  let driveFolderId = null;
  let driveError = null;

  if (uid) {
    try {
      // Obtener token válido de Google Drive (refresca automáticamente si es necesario)
      const tokenResult = await getValidGoogleDriveToken(uid);

      if (tokenResult.success) {
        // Crear la carpeta en Google Drive
        const driveResult = await createFolderGoogleDrive(
          tokenResult.access_token,
          folderPath
        );

        if (driveResult.success) {
          driveFolderCreated = true;
          driveFolderId = driveResult.folderId;
        } else {
          driveError = driveResult.errorText;
        }
      } else {
        driveError = `Token error: ${tokenResult.error}`;
      }
    } catch (error) {
      driveError = error.message;
    }
  }

  // Guardar experimento en Firestore con el ID recibido y el owner si se proporciona
  const experimentRef = db.collection("experiments").doc(experimentID);
  await experimentRef.set({
    title: experimentName,
    driveFolderPath: folderPath ?? null,
    driveFolderId: driveFolderId ?? null,
    storageProvider: "googledrive",
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

  return {
    success: true,
    message: "Experiment created successfully",
    experimentID: experimentID,
    driveFolderPath: folderPath,
    driveFolderId: driveFolderId,
    driveFolderCreated: driveFolderCreated,
    ...(driveError && { driveError }),
  };
}

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

    try {
      const result = await createExperimentGoogleDrive(
        experimentID,
        experimentName,
        uid
      );
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: `Internal server error: ${error.message}`,
      });
    }
  }
);
