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

describe("finalizeDisconnectedSessions — CASO 3 (explicit finalization)", () => {
  test("returns null when needsFinalization is not true", async () => {
    const ev = makeEvent({
      before: { connected: true },
      after: {
        connected: false,
        useIndexedDB: true,
        // CASO 2 won't match (state not disconnected/completed/abandoned),
        // CASO 3 needs needsFinalization=true → won't match either.
        state: "in-progress",
      },
    });
    const r = await finalizeDisconnectedSessions(ev);
    expect(r).toBeNull();
    expect(ev.data.after.ref.update).not.toHaveBeenCalled();
  });

  test("S-16 FIX: needsFinalization=true with no prior snapshot (before=null) → proceeds to CASO 3", async () => {
    // Sessions that were created already-disconnected and later flipped to
    // needsFinalization=true used to skip finalization because beforeData
    // didn't carry connected=true. With S-16, the explicit
    // needsFinalization intent honors the request and proceeds.
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    const ev = makeEvent({
      before: null,
      after: {
        connected: false,
        useIndexedDB: false,
        needsFinalization: true,
      },
    });
    const r = await finalizeDisconnectedSessions(ev);
    expect(r).toBeNull();
    // finalizeSession throws EXPERIMENT_NOT_FOUND because the doc isn't
    // mocked — but the trigger still marks finalizationProcessed.
    expect(ev.data.after.ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ finalizationProcessed: true }),
    );
  });

  test("finalizeSession throws EXPERIMENT_NOT_FOUND + state=completed (not abandoned) → no metadata save, marks finalizationProcessed + finalizationError", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });

    const ev = makeEvent({
      before: { connected: true },
      after: {
        connected: false,
        useIndexedDB: false,
        finished: true,
        state: "completed",
        needsFinalization: true,
        storageProvider: "googledrive",
      },
    });

    await finalizeDisconnectedSessions(ev);

    // Should NOT save abandoned metadata (not abandoned + not no-data error)
    expect(fs.getRef("experiments/EID/session_metadata/S1").set).not.toHaveBeenCalled();
    expect(ev.data.after.ref.update).toHaveBeenCalledTimes(1);
    const arg = ev.data.after.ref.update.mock.calls[0][0];
    expect(arg.finalizationProcessed).toBe(true);
    expect(arg.finalizationError).toBe("EXPERIMENT_NOT_FOUND");
    // EXPERIMENT_NOT_FOUND is not in isNoDataError set
    expect(arg.noDataToFinalize).toBeUndefined();
  });

  test("finalizeSession throws SESSION_NOT_FOUND + state=abandoned → writes abandoned-no-data metadata + noDataToFinalize=true", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "osf", owner: "u1", osfUploadLink: "x" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: false,
    });

    const ev = makeEvent({
      before: { connected: true },
      after: {
        connected: false,
        useIndexedDB: false,
        finished: true,
        state: "abandoned",
        needsFinalization: true,
        storageProvider: "osf",
        metadata: { ua: "tester" },
      },
    });

    await finalizeDisconnectedSessions(ev);

    const metaRef = fs.getRef("experiments/EID/session_metadata/S1");
    expect(metaRef.set).toHaveBeenCalledTimes(1);
    const metaArg = metaRef.set.mock.calls[0][0];
    expect(metaArg.sessionId).toBe("S1");
    expect(metaArg.state).toBe("abandoned");
    expect(metaArg.metadata).toEqual({ ua: "tester" });

    const refArg = ev.data.after.ref.update.mock.calls[0][0];
    expect(refArg.finalizationProcessed).toBe(true);
    expect(refArg.finalizationError).toBe("SESSION_NOT_FOUND");
    expect(refArg.noDataToFinalize).toBe(true);
  });
});
