/**
 * Tests for sessions/index.js::finalizeDisconnectedSessions (RTDB trigger).
 *
 * Three CASOs in the trigger:
 *   - CASO 1: !useIndexedDB → server is source of truth, immediate PATCH for
 *     Drive/Dropbox; OSF schedules timeout (T-7 unresolved).
 *   - CASO 2: useIndexedDB=true → schedule timeout cleanup; on completed/abandoned
 *     lookup fileUrl and write session_metadata.
 *   - CASO 3: needsFinalization=true → call finalizeSession and mark RTDB processed.
 *
 * Strategy: keep finalizeSession's own mocks set so that — when the trigger calls
 * it — it throws EXPERIMENT_NOT_FOUND right at step 2 (cheap proxy to exercise the
 * catch branch). For paths that don't reach finalizeSession (early returns,
 * scheduling, reconnect), just verify RTDB ref.update side-effects.
 *
 * Timeout work is delegated to Firebase task queue functions backed by Cloud
 * Tasks. These tests verify that the RTDB trigger writes the resume window and
 * enqueues a durable timeout task instead of keeping a setTimeout in memory.
 */
import { jest } from "@jest/globals";
import fetchMock from "../../helpers/fetch-mock.js";
import { makeFsMock } from "../../helpers/firestore-mock.js";

const fs = makeFsMock();
const mockWriteLog = jest.fn().mockResolvedValue(true);
const mockGetValidToken = jest.fn();
const mockCreateSession = jest.fn();
const mockAppendResult = jest.fn();
const mockTaskEnqueue = jest.fn().mockResolvedValue(undefined);
const mockTaskQueue = jest.fn(() => ({ enqueue: mockTaskEnqueue }));
const mockGetFunctions = jest.fn(() => ({ taskQueue: mockTaskQueue }));

const rtdbInner = {
  once: jest.fn().mockResolvedValue({ val: () => null }),
  update: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
};
const mockGetDatabase = jest.fn(() => ({ ref: jest.fn(() => rtdbInner) }));

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
}));
jest.unstable_mockModule("firebase-functions/v2/database", () => ({
  onValueWritten: (_opts, handler) => handler,
}));
jest.unstable_mockModule("firebase-functions/v2/tasks", () => ({
  onTaskDispatched: (_opts, handler) => handler,
}));
jest.unstable_mockModule("firebase-admin/functions", () => ({
  getFunctions: mockGetFunctions,
}));
jest.unstable_mockModule("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (n) => ({ __op: "increment", value: n }),
    serverTimestamp: () => ({ __op: "serverTimestamp" }),
  },
}));
jest.unstable_mockModule("firebase-admin/database", () => ({
  getDatabase: mockGetDatabase,
}));
jest.unstable_mockModule("../../../app.js", () => ({ db: fs.db, app: {} }));
jest.unstable_mockModule("../../../experiment/sessions/logging/write-log.js", () => ({
  default: mockWriteLog,
}));
jest.unstable_mockModule("../../../oauth/index.js", () => ({
  getValidToken: mockGetValidToken,
}));
jest.unstable_mockModule("../../../experiment/sessions/storage.js", () => ({
  createSession: mockCreateSession,
  appendResult: mockAppendResult,
  postFile: jest.fn(),
  escapeDriveQueryValue: (v) => String(v ?? ""),
}));
jest.unstable_mockModule("../../../experiment/sessions/handler.js", () => ({
  handleCreateSession: jest.fn(),
  handleAppendResult: jest.fn(),
  handleListSessions: jest.fn(),
  handleDownloadSession: jest.fn(),
  handleDeleteSession: jest.fn(),
}));

const { finalizeDisconnectedSessions } = await import(
  "../../../experiment/sessions/index.js"
);

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fs.db.batch.mockClear();
  fetchMock.__reset();
  mockWriteLog.mockClear();
  mockGetValidToken.mockReset();
  mockCreateSession.mockReset();
  mockAppendResult.mockReset();
  mockTaskEnqueue.mockClear();
  mockTaskQueue.mockClear();
  mockGetFunctions.mockClear();
  rtdbInner.once.mockClear();
  rtdbInner.update.mockClear();
  rtdbInner.remove.mockClear();
  rtdbInner.once.mockResolvedValue({ val: () => null });
});

function makeEvent({
  before,
  after,
  experimentID = "EID",
  sessionId = "S1",
} = {}) {
  const ref = {
    update: jest.fn().mockResolvedValue(undefined),
    once: jest.fn().mockResolvedValue({ val: () => after }),
  };
  return {
    data: {
      before: { val: () => before },
      after: { val: () => after, ref },
    },
    params: { experimentID, sessionId },
  };
}

// ─── Early returns ─────────────────────────────────────────────────────────

// ─── CASO 1: !useIndexedDB ─────────────────────────────────────────────────

// ─── CASO 2: useIndexedDB ──────────────────────────────────────────────────

// ─── CASO 3: needsFinalization ─────────────────────────────────────────────

describe("finalizeDisconnectedSessions — CASO 1 (server source of truth)", () => {
  test("OSF disconnect → enqueues durable timeout task", async () => {
    const ev = makeEvent({
      before: { connected: true },
      after: {
        connected: false,
        useIndexedDB: false,
        state: "disconnected",
        finished: false,
        storageProvider: "osf",
        resumeTimeoutMinutes: 5,
      },
    });

    await finalizeDisconnectedSessions(ev);

    expect(ev.data.after.ref.update).toHaveBeenCalledTimes(2);
    const arg = ev.data.after.ref.update.mock.calls[0][0];
    expect(arg).toHaveProperty("resumeExpiresAt");
    expect(arg).toHaveProperty("resumeTimeoutStarted");
    expect(arg.resumeTimeoutTaskStatus).toBe("pending");
    expect(mockTaskQueue).toHaveBeenCalledWith(
      "locations/us-central1/functions/processSessionTimeout",
    );
    expect(mockTaskEnqueue).toHaveBeenCalledTimes(1);
    expect(mockTaskEnqueue.mock.calls[0][0]).toEqual({
      experimentID: "EID",
      sessionId: "S1",
      expiresAt: arg.resumeExpiresAt,
    });
    expect(mockTaskEnqueue.mock.calls[0][1]).toEqual({
      scheduleTime: new Date(arg.resumeExpiresAt),
      dispatchDeadlineSeconds: 120,
    });
    expect(ev.data.after.ref.update.mock.calls[1][0]).toMatchObject({
      resumeTimeoutTaskStatus: "queued",
      resumeTimeoutTaskError: null,
    });
    // finalizeSession not invoked synchronously; task worker owns expiration.
    expect(mockWriteLog).not.toHaveBeenCalled();
  });

  test("Drive disconnect → finalizeSession runs immediately, throws EXPERIMENT_NOT_FOUND, ref logs lastPatchError", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });

    const ev = makeEvent({
      before: { connected: true },
      after: {
        connected: false,
        useIndexedDB: false,
        state: "disconnected",
        finished: false,
        storageProvider: "googledrive",
      },
    });

    await finalizeDisconnectedSessions(ev);

    expect(mockWriteLog).toHaveBeenCalledWith("EID", "finishSession");
    // Error branch: lastPatchError + lastPatchErrorAt
    expect(ev.data.after.ref.update).toHaveBeenCalledTimes(1);
    const arg = ev.data.after.ref.update.mock.calls[0][0];
    expect(arg.lastPatchError).toBe("EXPERIMENT_NOT_FOUND");
    expect(arg).toHaveProperty("lastPatchErrorAt");
  });

  test("OSF reconnect (!useIndexedDB) → writes state=resumed and clears timeout fields", async () => {
    const ev = makeEvent({
      before: { connected: false },
      after: {
        connected: true,
        useIndexedDB: false,
        storageProvider: "osf",
        state: "disconnected",
        finished: false,
      },
    });

    const r = await finalizeDisconnectedSessions(ev);
    expect(r).toBeNull();
    expect(ev.data.after.ref.update).toHaveBeenCalledTimes(1);
    const arg = ev.data.after.ref.update.mock.calls[0][0];
    expect(arg.state).toBe("resumed");
    expect(arg.resumeExpiresAt).toBeNull();
    expect(arg.resumeTimeoutStarted).toBeNull();
    expect(arg).toHaveProperty("resumedAt");
  });

  test("Drive/Dropbox reconnect (!useIndexedDB) → no-op (no timeout to cancel; patch was immediate)", async () => {
    const ev = makeEvent({
      before: { connected: false },
      after: {
        connected: true,
        useIndexedDB: false,
        storageProvider: "googledrive",
      },
    });
    const r = await finalizeDisconnectedSessions(ev);
    expect(r).toBeNull();
    expect(ev.data.after.ref.update).not.toHaveBeenCalled();
  });
});
