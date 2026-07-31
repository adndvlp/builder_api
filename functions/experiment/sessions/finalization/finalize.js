import { db } from "../../../app.js";
import writeLog from "../logging/write-log.js";
import { getValidToken } from "../../../oauth/index.js";
import { appendResult } from "../storage.js";
import { buildSessionCsv } from "./csv.js";
import {
  readRealtimeSessionData,
  recordBatchParseFailures,
  saveFinalSessionMetadata,
} from "./metadata.js";
import {
  prepareStorageCsv,
  resolveFolderIdentifier,
} from "./storage-file.js";
import { cleanupTemporarySession } from "./cleanup.js";

/**
 * Función auxiliar INTERNA para finalizar sesión (lógica pura sin req/res).
 * Esta función puede ser llamada desde el endpoint HTTP o desde Cloud Functions.
 */
export async function finalizeSession(experimentID, sessionId) {
  await writeLog(experimentID, "finishSession");

  const expDocRef = db.collection("experiments").doc(experimentID);
  const expDoc = await expDocRef.get();

  if (!expDoc.exists) {
    console.error(`[finalizeSession] EXPERIMENT_NOT_FOUND: ${experimentID}`);
    throw new Error("EXPERIMENT_NOT_FOUND");
  }

  const expData = expDoc.data();
  const storageProvider = expData.storageProvider || "googledrive";
  const tokenResult = await getValidToken(storageProvider, expData.owner);

  if (!tokenResult.success) {
    console.error(
      `[finalizeSession] Invalid token for storageProvider=${storageProvider}`,
    );
    throw new Error(
      storageProvider === "dropbox"
        ? "INVALID_DROPBOX_TOKEN"
        : "INVALID_GOOGLE_DRIVE_TOKEN",
    );
  }

  const { sessionState, rtdbMetadata } = await readRealtimeSessionData(
    experimentID,
    sessionId,
  );

  const sessionRef = db
    .collection("experiments")
    .doc(experimentID)
    .collection("sessions")
    .doc(sessionId);
  const sessionDoc = await sessionRef.get();

  if (!sessionDoc.exists) {
    console.error(
      `[finalizeSession] SESSION_NOT_FOUND: experiments/${experimentID}/sessions/${sessionId}`,
    );
    throw new Error("SESSION_NOT_FOUND");
  }

  const sessionData = sessionDoc.data();
  const trialsSnapshot = await sessionRef.collection("trials").get();

  if (trialsSnapshot.empty) {
    console.error(
      `[finalizeSession] NO_RESULTS: no trials found for session ${sessionId}`,
    );
    throw new Error("NO_RESULTS");
  }

  const csvBuild = buildSessionCsv(
    trialsSnapshot,
    sessionData,
    sessionState,
    sessionId,
  );
  await recordBatchParseFailures(
    experimentID,
    sessionId,
    csvBuild.parseFailures,
  );

  console.log(
    `Final CSV to send to ${storageProvider}: ${csvBuild.finalCsv.length} bytes, ` +
      `${csvBuild.dataWithMetadata.length} rows, ${csvBuild.allFields.length} cols`,
  );

  const folderIdentifier = resolveFolderIdentifier(storageProvider, expData);
  const prepared = await prepareStorageCsv({
    storageProvider,
    token: tokenResult.access_token,
    folderIdentifier,
    experimentID,
    sessionId,
    finalCsv: csvBuild.finalCsv,
  });

  const appendResult_ = await appendResult(
    storageProvider,
    tokenResult.access_token,
    folderIdentifier,
    experimentID,
    sessionId,
    prepared.finalCsv,
  );

  if (!appendResult_.success) {
    throw new Error(
      appendResult_.errorText || `Failed to send results to ${storageProvider}`,
    );
  }

  console.log(
    `All results sent to ${storageProvider}`,
    prepared.fileExists ? "(PATCH to existing file)" : "(new file)",
  );

  await cleanupTemporarySession(sessionRef);
  await saveFinalSessionMetadata({
    experimentID,
    sessionId,
    sessionData,
    rtdbMetadata,
    sessionState,
    storageProvider,
    appendResult: appendResult_,
  });

  return {
    success: true,
    message: "Session finished successfully",
    resultsSent: csvBuild.results.length,
    fileExists: prepared.fileExists,
    patchMode: prepared.isPatchMode,
  };
}
