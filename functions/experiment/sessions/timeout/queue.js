import { getFunctions } from "firebase-admin/functions";
import { app } from "../../../app.js";

export const SESSION_TIMEOUT_TASK_REGION = "us-central1";
export const SESSION_TIMEOUT_TASK_FUNCTION = "processSessionTimeout";
export const SESSION_TIMEOUT_TASK_QUEUE =
  `locations/${SESSION_TIMEOUT_TASK_REGION}/functions/${SESSION_TIMEOUT_TASK_FUNCTION}`;
export const SESSION_TIMEOUT_TASK_DISPATCH_DEADLINE_SECONDS = 120;

export function validateSessionTimeoutTaskPayload(data) {
  const experimentID = data?.experimentID;
  const sessionId = data?.sessionId;
  const expiresAt = data?.expiresAt;

  if (
    typeof experimentID !== "string" ||
    experimentID.length === 0 ||
    experimentID.includes("/") ||
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    sessionId.includes("/") ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt)
  ) {
    throw new Error("INVALID_SESSION_TIMEOUT_TASK_PAYLOAD");
  }

  return { experimentID, sessionId, expiresAt };
}

export async function scheduleSessionTimeoutTask({
  experimentID,
  sessionId,
  expiresAt,
}) {
  const payload = validateSessionTimeoutTaskPayload({
    experimentID,
    sessionId,
    expiresAt,
  });
  const queue = getFunctions(app).taskQueue(SESSION_TIMEOUT_TASK_QUEUE);

  await queue.enqueue(payload, {
    scheduleTime: new Date(expiresAt),
    dispatchDeadlineSeconds: SESSION_TIMEOUT_TASK_DISPATCH_DEADLINE_SECONDS,
  });
}
