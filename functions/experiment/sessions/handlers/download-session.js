import { db } from "../../../app.js";
import writeLog from "../logging/write-log.js";
import MESSAGES from "../../api/messages.js";
import { getValidToken } from "../../../oauth/index.js";
import { downloadSession } from "../storage.js";
import {
  getInvalidTokenMessage,
  getSessionFolderIdentifier,
} from "./helpers.js";

/**
 * Función auxiliar para descargar sesión como CSV
 */
export async function handleDownloadSession(req, res, experimentID, sessionId) {
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
      res.status(400).json(getInvalidTokenMessage(storageProvider));
      return;
    }

    const folderIdentifier = getSessionFolderIdentifier(exp_data);

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
    });
  }
}
