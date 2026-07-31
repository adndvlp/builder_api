import { db } from "../../../app.js";
import writeLog from "../logging/write-log.js";
import MESSAGES from "../../api/messages.js";
import { getValidToken } from "../../../oauth/index.js";
import { listSessions } from "../storage.js";
import {
  getInvalidTokenMessage,
  getSessionFolderIdentifier,
} from "./helpers.js";

/**
 * Función auxiliar para listar sesiones
 */
export async function handleListSessions(req, res, experimentID) {
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
      res.status(400).json(getInvalidTokenMessage(storageProvider));
      return;
    }

    const folderIdentifier = getSessionFolderIdentifier(exp_data);

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
    });
  }
}
