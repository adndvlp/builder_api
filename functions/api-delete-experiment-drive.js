import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import { deleteFolderGoogleDrive } from "./crud-file-google-drive.js";
import getValidGoogleDriveToken from "./refresh-google-drive-token.js";

export const apiDeleteExperiment = onRequest(
  { cors: true },
  async (req, res) => {
    // Validar parámetros requeridos
    const { experimentID, uid } = req.body;

    if (!experimentID) {
      res.status(400).json({
        success: false,
        message: "Missing required parameter: experimentID",
      });
      return;
    }

    await writeLog(experimentID, "deleteExperiment");

    try {
      // Obtener información del experimento desde Firestore
      const experimentRef = db.collection("experiments").doc(experimentID);
      const experimentDoc = await experimentRef.get();

      if (!experimentDoc.exists) {
        res.status(404).json({
          success: false,
          message: "Experiment not found",
        });
        return;
      }

      const experimentData = experimentDoc.data();
      const folderPath = experimentData.driveFolderPath;
      const folderId = experimentData.driveFolderId;

      // Intentar eliminar la carpeta de Google Drive si se proporciona uid
      let driveFolderDeleted = false;
      let driveError = null;

      if (uid && folderPath) {
        try {
          // Obtener token válido de Google Drive (refresca automáticamente si es necesario)
          const tokenResult = await getValidGoogleDriveToken(uid);

          if (tokenResult.success) {
            // Eliminar la carpeta en Google Drive (esto eliminará todo el contenido)
            const driveResult = await deleteFolderGoogleDrive(
              tokenResult.access_token,
              folderPath
            );

            if (driveResult.success) {
              driveFolderDeleted = true;
            } else {
              driveError = driveResult.errorText;
              console.error("Error deleting Google Drive folder:", driveError);
            }
          } else {
            driveError = `Token error: ${tokenResult.error}`;
            console.error(
              "Error getting valid Google Drive token:",
              tokenResult.error
            );
          }
        } catch (error) {
          console.error("Error accessing user data or deleting folder:", error);
          driveError = error.message;
        }
      }

      // Eliminar el documento del experimento en Firestore
      await experimentRef.delete();

      res.status(200).json({
        success: true,
        message: "Experiment deleted successfully",
        experimentID: experimentID,
        driveFolderDeleted: driveFolderDeleted,
        ...(driveError && { driveWarning: driveError }),
      });
    } catch (error) {
      console.error("Error deleting experiment:", error);
      res.status(500).json({
        success: false,
        message: `Internal server error: ${error.message}`,
      });
    }
  }
);
