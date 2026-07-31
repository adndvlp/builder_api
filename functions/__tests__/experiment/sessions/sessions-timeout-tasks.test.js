import { jest } from "@jest/globals";
import {
  makeFsMock,
  makeSnapshot,
} from "../../helpers/firestore-mock.js";

const fs = makeFsMock();
const mockFinalizeSession = jest.fn();
const mockTaskEnqueue = jest.fn().mockResolvedValue(undefined);
const mockTaskQueue = jest.fn(() => ({ enqueue: mockTaskEnqueue }));
const mockGetFunctions = jest.fn(() => ({ taskQueue: mockTaskQueue }));
const rtdbRef = {
  once: jest.fn(),
  update: jest.fn().mockResolvedValue(undefined),
};
const mockRtdbRef = jest.fn(() => rtdbRef);

jest.unstable_mockModule("firebase-functions/v2/tasks", () => ({
  onTaskDispatched: (_opts, handler) => handler,
}));
jest.unstable_mockModule("firebase-admin/functions", () => ({
  getFunctions: mockGetFunctions,
}));
jest.unstable_mockModule("firebase-admin/database", () => ({
  getDatabase: jest.fn(() => ({ ref: mockRtdbRef })),
}));
jest.unstable_mockModule("../../../app.js", () => ({ app: {}, db: fs.db }));
jest.unstable_mockModule("../../../experiment/sessions/finalization/finalize.js", () => ({
  finalizeSession: mockFinalizeSession,
}));

const {
  handleSessionTimeoutTask,
  processSessionTimeout,
  scheduleSessionTimeoutTask,
} = await import("../../../experiment/sessions/timeout/tasks.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fs.db.batch.mockClear();
  mockFinalizeSession.mockReset();
  mockTaskEnqueue.mockClear();
  mockTaskQueue.mockClear();
  mockGetFunctions.mockClear();
  rtdbRef.once.mockReset();
  rtdbRef.update.mockClear();
  mockRtdbRef.mockClear();
  rtdbRef.once.mockResolvedValue({ val: () => null });
});

describe("scheduleSessionTimeoutTask", () => {
  test("enqueues the timeout worker with an absolute Cloud Tasks schedule", async () => {
    const expiresAt = Date.now() + 30 * 60 * 1000;

    await scheduleSessionTimeoutTask({
      experimentID: "EID",
      sessionId: "S1",
      expiresAt,
    });

    expect(mockTaskQueue).toHaveBeenCalledWith(
      "locations/us-central1/functions/processSessionTimeout",
    );
    expect(mockTaskEnqueue).toHaveBeenCalledWith(
      { experimentID: "EID", sessionId: "S1", expiresAt },
      {
        scheduleTime: new Date(expiresAt),
        dispatchDeadlineSeconds: 120,
      },
    );
  });
});

describe("handleSessionTimeoutTask", () => {
  test("no-ops when the RTDB session no longer exists", async () => {
    const result = await handleSessionTimeoutTask({
      experimentID: "EID",
      sessionId: "S1",
      expiresAt: Date.now() - 1,
    });

    expect(result).toEqual({ status: "missing_session" });
    expect(rtdbRef.update).not.toHaveBeenCalled();
  });

  test("no-ops stale tasks whose expiresAt no longer matches RTDB", async () => {
    rtdbRef.once.mockResolvedValueOnce({
      val: () => ({
        connected: false,
        state: "disconnected",
        resumeExpiresAt: 2000,
      }),
    });

    const result = await handleSessionTimeoutTask({
      experimentID: "EID",
      sessionId: "S1",
      expiresAt: 1000,
    });

    expect(result).toEqual({ status: "stale_task" });
    expect(rtdbRef.update).not.toHaveBeenCalled();
  });

  test("no-ops when the participant already reconnected", async () => {
    rtdbRef.once.mockResolvedValueOnce({
      val: () => ({
        connected: true,
        state: "resumed",
        resumeExpiresAt: null,
      }),
    });

    const result = await handleSessionTimeoutTask({
      experimentID: "EID",
      sessionId: "S1",
      expiresAt: 1000,
    });

    expect(result).toEqual({ status: "not_disconnected" });
    expect(rtdbRef.update).not.toHaveBeenCalled();
  });

  test("expires IndexedDB sessions and deletes temp Firestore trials in batches", async () => {
    const expiresAt = Date.now() - 1000;
    rtdbRef.once.mockResolvedValueOnce({
      val: () => ({
        connected: false,
        state: "disconnected",
        useIndexedDB: true,
        storageProvider: "googledrive",
        resumeExpiresAt: expiresAt,
        metadata: { browser: "Chrome" },
      }),
    });

    const firstBatch = makeSnapshot(
      Array.from({ length: 500 }, (_, i) => ({
        id: `trial-${i}`,
        data: { trial_index: i },
      })),
    );
    const secondBatch = makeSnapshot([
      { id: "trial-500", data: { trial_index: 500 } },
    ]);
    fs.getCol("experiments/EID/sessions/S1/trials").get
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);

    const result = await handleSessionTimeoutTask({
      experimentID: "EID",
      sessionId: "S1",
      expiresAt,
    });

    expect(result).toEqual({
      status: "expired_indexeddb_session",
      trialsDeleted: 501,
    });
    expect(fs.db.batch).toHaveBeenCalledTimes(2);
    expect(fs.db.batch.mock.results[0].value.__ops).toHaveLength(500);
    expect(fs.db.batch.mock.results[1].value.__ops).toHaveLength(1);
    expect(fs.getRef("experiments/EID/sessions/S1").delete).toHaveBeenCalled();
    expect(
      fs.getRef("experiments/EID/session_metadata/S1").set,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "S1",
        state: "expired",
        metadata: { browser: "Chrome" },
        storageProvider: "googledrive",
      }),
      { merge: true },
    );
    expect(rtdbRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "expired",
        finalizationProcessed: true,
        resumeTimeoutTaskStatus: "processed",
      }),
    );
  });

  test("finalizes expired OSF sessions without IndexedDB", async () => {
    const expiresAt = Date.now() - 1000;
    rtdbRef.once.mockResolvedValueOnce({
      val: () => ({
        connected: false,
        state: "disconnected",
        useIndexedDB: false,
        storageProvider: "osf",
        resumeExpiresAt: expiresAt,
        metadata: { browser: "Firefox" },
      }),
    });
    mockFinalizeSession.mockResolvedValueOnce({ success: true, resultsSent: 7 });

    const result = await handleSessionTimeoutTask({
      experimentID: "EID",
      sessionId: "S1",
      expiresAt,
    });

    expect(result).toEqual({
      status: "expired_osf_session",
      resultsSent: 7,
    });
    expect(mockFinalizeSession).toHaveBeenCalledWith("EID", "S1");
    expect(
      fs.getRef("experiments/EID/session_metadata/S1").set,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "S1",
        state: "expired",
        metadata: { browser: "Firefox" },
        storageProvider: "osf",
      }),
      { merge: true },
    );
    expect(rtdbRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "expired",
        finalizationProcessed: true,
        resultsSent: 7,
        resumeTimeoutTaskStatus: "processed",
      }),
    );
  });

  test("marks no-data OSF expirations as processed without retrying forever", async () => {
    const expiresAt = Date.now() - 1000;
    rtdbRef.once.mockResolvedValueOnce({
      val: () => ({
        connected: false,
        state: "disconnected",
        useIndexedDB: false,
        storageProvider: "osf",
        resumeExpiresAt: expiresAt,
      }),
    });
    mockFinalizeSession.mockRejectedValueOnce(new Error("NO_RESULTS"));

    const result = await handleSessionTimeoutTask({
      experimentID: "EID",
      sessionId: "S1",
      expiresAt,
    });

    expect(result).toEqual({
      status: "expired_osf_no_data",
      error: "NO_RESULTS",
    });
    expect(rtdbRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "expired",
        finalizationProcessed: true,
        finalizationError: "NO_RESULTS",
        noDataToFinalize: true,
      }),
    );
  });
});

describe("processSessionTimeout", () => {
  test("uses the task request data payload", async () => {
    await processSessionTimeout({
      data: { experimentID: "EID", sessionId: "S1", expiresAt: Date.now() - 1 },
    });

    expect(mockRtdbRef).toHaveBeenCalledWith("sessions/EID/S1");
  });
});
