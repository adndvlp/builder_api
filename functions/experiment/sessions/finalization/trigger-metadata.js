import { db } from "../../../app.js";

export async function saveIndexedDbSessionMetadata({
  experimentID,
  sessionId,
  state,
  afterData,
  fileUrl,
}) {
  try {
    await db
      .collection("experiments")
      .doc(experimentID)
      .collection("session_metadata")
      .doc(sessionId)
      .set(
        {
          sessionId,
          state,
          completedAt: new Date().toISOString(),
          metadata: afterData.metadata || {},
          storageProvider: afterData.storageProvider || "googledrive",
          ...(fileUrl && { fileUrl }),
        },
        { merge: true },
      );
  } catch (metaErr) {
    console.error("Error saving session_metadata:", metaErr);
  }
}

export async function saveAbandonedNoDataMetadata(
  experimentID,
  sessionId,
  afterData,
) {
  try {
    await db
      .collection("experiments")
      .doc(experimentID)
      .collection("session_metadata")
      .doc(sessionId)
      .set({
        sessionId,
        state: "abandoned",
        completedAt: new Date().toISOString(),
        metadata: afterData.metadata || {},
      });
    console.log(
      `Abandoned-no-data session ${sessionId} metadata saved to Firestore`,
    );
  } catch (metaErr) {
    console.error("Error saving abandoned-no-data session metadata:", metaErr);
  }
}
