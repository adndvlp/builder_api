import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import { deleteFolderDropbox } from "./crud-file-dropbox.js";
import getValidDropboxToken from "./refresh-dropbox-token.js";

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
      const folderPath = experimentData.dropboxFolder;

      // Intentar eliminar la carpeta de Dropbox si se proporciona uid
      let dropboxFolderDeleted = false;
      let dropboxError = null;

      if (uid && folderPath) {
        try {
          // Obtener token válido de Dropbox (refresca automáticamente si es necesario)
          const tokenResult = await getValidDropboxToken(uid);

          if (tokenResult.success) {
            // Eliminar la carpeta en Dropbox (esto eliminará todo el contenido)
            const dropboxResult = await deleteFolderDropbox(
              tokenResult.access_token,
              folderPath
            );

            if (dropboxResult.success) {
              dropboxFolderDeleted = true;
            } else {
              dropboxError = dropboxResult.errorText;
              console.error("Error deleting Dropbox folder:", dropboxError);
            }
          } else {
            dropboxError = `Token error: ${tokenResult.error}`;
            console.error(
              "Error getting valid Dropbox token:",
              tokenResult.error
            );
          }
        } catch (error) {
          console.error("Error accessing user data or deleting folder:", error);
          dropboxError = error.message;
        }
      }

      // Eliminar el documento del experimento en Firestore
      await experimentRef.delete();

      res.status(200).json({
        success: true,
        message: "Experiment deleted successfully",
        experimentID: experimentID,
        dropboxFolderDeleted: dropboxFolderDeleted,
        ...(dropboxError && { dropboxWarning: dropboxError }),
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
