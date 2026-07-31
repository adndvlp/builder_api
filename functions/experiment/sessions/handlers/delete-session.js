import { db } from "../../../app.js";
import writeLog from "../logging/write-log.js";
import MESSAGES from "../../api/messages.js";
import { getValidToken } from "../../../oauth/index.js";
import { deleteSession } from "../storage.js";
import {
  getInvalidTokenMessage,
  getSessionFolderIdentifier,
} from "./helpers.js";

/**
 * Función auxiliar para eliminar sesión
 */
export async function handleDeleteSession(req, res, experimentID, sessionId) {
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
      res.status(400).json(getInvalidTokenMessage(storageProvider));
      return;
    }

    const folderIdentifier = getSessionFolderIdentifier(exp_data);

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

    // H-5: floor the decrement at 0 so deleting an "uncounted" session (e.g.
    // imported test data, or a duplicate delete) doesn't drive the counter
    // negative. Wrapped in a transaction to avoid lost updates.
    try {
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(exp_doc_ref);
        const current = snap.exists ? snap.data()?.sessions || 0 : 0;
        transaction.set(
          exp_doc_ref,
          { sessions: Math.max(0, current - 1) },
          { merge: true },
        );
      });
    } catch (txnErr) {
      console.error(
        "[handleDeleteSession] sessions counter txn failed:",
        txnErr,
      );
    }

    res.status(200).json({
      success: true,
      message: "Session deleted successfully",
    });
  } catch (error) {
    console.error("Error in handleDeleteSession:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}
