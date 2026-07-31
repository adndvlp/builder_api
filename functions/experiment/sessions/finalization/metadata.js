import { getDatabase } from "firebase-admin/database";
import { app, db } from "../../../app.js";

export async function readRealtimeSessionData(experimentID, sessionId) {
  let sessionState = null;
  let rtdbMetadata = {};

  try {
    const rtdb = getDatabase(app);
    const sessionSnapshot = await rtdb
      .ref(`sessions/${experimentID}/${sessionId}`)
      .once("value");
    const sessionData = sessionSnapshot.val();
    if (sessionData) {
      if (sessionData.state) sessionState = sessionData.state;
      if (sessionData.metadata) rtdbMetadata = sessionData.metadata;
    }
  } catch (error) {
    console.error("Error reading state from Realtime Database:", error);
  }

  return { sessionState, rtdbMetadata };
}

export async function recordBatchParseFailures(
  experimentID,
  sessionId,
  parseFailures,
) {
  if (parseFailures.length === 0) return;

  console.warn(
    `[finalizeSession] ${parseFailures.length} batch(es) failed to parse for session ${sessionId} — see session_metadata.batchParseFailures`,
  );

  try {
    await db
      .collection("experiments")
      .doc(experimentID)
      .collection("session_metadata")
      .doc(sessionId)
      .set(
        {
          batchParseFailures: parseFailures.slice(0, 20),
          batchParseFailureCount: parseFailures.length,
        },
        { merge: true },
      );
  } catch (metaErr) {
    console.error(
      "[finalizeSession] Could not record batch parse failures:",
      metaErr,
    );
  }
}

export async function saveFinalSessionMetadata({
  experimentID,
  sessionId,
  sessionData,
  rtdbMetadata,
  sessionState,
  storageProvider,
  appendResult,
}) {
  try {
    const finalState =
      sessionState && sessionState !== "completed"
        ? sessionState
        : "completed";
    const combinedMetadata = {
      ...(sessionData.metadata || {}),
      ...rtdbMetadata,
    };
    const metaDocRef = db
      .collection("experiments")
      .doc(experimentID)
      .collection("session_metadata")
      .doc(sessionId);
    const driveFileUrl =
      storageProvider === "googledrive" && appendResult.id
        ? `https://drive.google.com/uc?export=download&id=${appendResult.id}`
        : (storageProvider === "dropbox" || storageProvider === "osf") &&
            appendResult.fileUrl
          ? appendResult.fileUrl
          : null;
    const metaPayload = {
      sessionId,
      state: finalState,
      completedAt: new Date().toISOString(),
      createdAt: sessionData.createdAt || new Date().toISOString(),
      metadata: combinedMetadata,
      ...(driveFileUrl && { fileUrl: driveFileUrl }),
    };
    await metaDocRef.set(metaPayload);
  } catch (metaErr) {
    console.error("Error saving session_metadata:", metaErr);
  }
}
