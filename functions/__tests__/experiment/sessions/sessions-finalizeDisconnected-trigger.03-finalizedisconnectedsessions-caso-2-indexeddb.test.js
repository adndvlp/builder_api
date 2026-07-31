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

describe("finalizeDisconnectedSessions — CASO 2 (IndexedDB)", () => {
  test("disconnect + state=disconnected + !finished → enqueues durable timeout task", async () => {
    const ev = makeEvent({
      before: { connected: true },
      after: {
        connected: false,
        useIndexedDB: true,
        state: "disconnected",
        finished: false,
        resumeTimeoutMinutes: 30,
      },
    });

    await finalizeDisconnectedSessions(ev);

    expect(ev.data.after.ref.update).toHaveBeenCalledTimes(2);
    const arg = ev.data.after.ref.update.mock.calls[0][0];
    expect(arg).toHaveProperty("resumeExpiresAt");
    expect(arg).toHaveProperty("resumeTimeoutStarted");
    expect(arg.resumeTimeoutTaskStatus).toBe("pending");
    expect(mockTaskEnqueue).toHaveBeenCalledWith(
      {
        experimentID: "EID",
        sessionId: "S1",
        expiresAt: arg.resumeExpiresAt,
      },
      {
        scheduleTime: new Date(arg.resumeExpiresAt),
        dispatchDeadlineSeconds: 120,
      },
    );
    expect(ev.data.after.ref.update.mock.calls[1][0]).toMatchObject({
      resumeTimeoutTaskStatus: "queued",
      resumeTimeoutTaskError: null,
    });
  });

  test("reconnect (useIndexedDB, any provider) → writes state=resumed and clears timeout fields", async () => {
    const ev = makeEvent({
      before: { connected: false },
      after: {
        connected: true,
        useIndexedDB: true,
        state: "disconnected",
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

  test("state=completed → looks up fileUrl, writes session_metadata, marks processed", async () => {
    // expDoc missing → fileUrl lookup short-circuits to null; session_metadata
    // is still written, then finalizationProcessed set on RTDB ref.
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });

    const ev = makeEvent({
      before: { connected: true },
      after: {
        connected: false,
        useIndexedDB: true,
        state: "completed",
        finished: true,
        storageProvider: "googledrive",
        metadata: { browser: "chrome" },
      },
    });

    await finalizeDisconnectedSessions(ev);

    // session_metadata.set called with merge
    const metaRef = fs.getRef("experiments/EID/session_metadata/S1");
    expect(metaRef.set).toHaveBeenCalledTimes(1);
    const [body, opts] = metaRef.set.mock.calls[0];
    expect(body.sessionId).toBe("S1");
    expect(body.state).toBe("completed");
    expect(body.storageProvider).toBe("googledrive");
    expect(body.metadata).toEqual({ browser: "chrome" });
    expect(opts).toEqual({ merge: true });

    // finalizationProcessed marked
    expect(ev.data.after.ref.update).toHaveBeenCalledTimes(1);
    const refArg = ev.data.after.ref.update.mock.calls[0][0];
    expect(refArg.finalizationProcessed).toBe(true);
    expect(refArg).toHaveProperty("processedAt");
  });

  test("state=abandoned → also writes session_metadata + marks processed", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });

    const ev = makeEvent({
      before: { connected: true },
      after: {
        connected: false,
        useIndexedDB: true,
        state: "abandoned",
        finished: true,
        storageProvider: "dropbox",
      },
    });

    await finalizeDisconnectedSessions(ev);

    const metaRef = fs.getRef("experiments/EID/session_metadata/S1");
    expect(metaRef.set).toHaveBeenCalled();
    expect(metaRef.set.mock.calls[0][0].state).toBe("abandoned");
    expect(ev.data.after.ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ finalizationProcessed: true }),
    );
  });
});
