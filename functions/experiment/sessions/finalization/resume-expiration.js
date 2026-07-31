import { scheduleSessionTimeoutTask } from "../timeout/queue.js";

export async function scheduleResumeExpiration({
  ref,
  experimentID,
  sessionId,
  expiresAt,
}) {
  await ref.update({
    resumeExpiresAt: expiresAt,
    resumeTimeoutStarted: Date.now(),
    resumeTimeoutTaskStatus: "pending",
  });

  try {
    await scheduleSessionTimeoutTask({ experimentID, sessionId, expiresAt });
    await ref.update({
      resumeTimeoutTaskStatus: "queued",
      resumeTimeoutTaskQueuedAt: Date.now(),
      resumeTimeoutTaskError: null,
    });
  } catch (error) {
    await ref.update({
      resumeTimeoutTaskStatus: "enqueue_failed",
      resumeTimeoutTaskError: error.message,
      resumeTimeoutTaskErrorAt: Date.now(),
    });
    throw error;
  }
}
