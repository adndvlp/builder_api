import { db } from "../../../app.js";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Increment a per-action counter at `logs/{experimentID}`. Fire-and-forget
 * observability — callers `await` only to ensure ordering, never branch on
 * the result. Errors are swallowed so a logs-collection outage can't break
 * the request pipeline.
 */
export default async function writeLog(experimentID, action) {
  if (!experimentID || !action) return;
  try {
    await db
      .collection("logs")
      .doc(experimentID)
      .set({ [action]: FieldValue.increment(1) }, { merge: true });
  } catch (error) {
    console.error(`writeLog(${experimentID}, ${action}) failed:`, error);
  }
}
