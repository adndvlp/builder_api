/**
 * Tests for sessions/index.js::apiData — the HTTP router that dispatches:
 *   - action=list/download/delete → respective handler in handler.js
 *   - action=finish → finalizeSession (errors go through handleFinalizationError)
 *   - action=updateSessionName → set session_metadata
 *   - sessionId+!data → handleCreateSession (no action)
 *   - sessionId+data → handleAppendResult (no action)
 *   - else → handlePostFile (legacy postFile flow with validation + sessions increment)
 */
import { jest } from "@jest/globals";
import { makeFsMock, makeReq, makeRes } from "../../helpers/firestore-mock.js";

const fs = makeFsMock();
const mockWriteLog = jest.fn().mockResolvedValue(true);
const mockGetValidToken = jest.fn();
const mockCreateSession = jest.fn();
const mockAppendResult = jest.fn();
const mockPostFile = jest.fn();
const mockHandleCreateSession = jest.fn();
const mockHandleAppendResult = jest.fn();
const mockHandleListSessions = jest.fn();
const mockHandleDownloadSession = jest.fn();
const mockHandleDeleteSession = jest.fn();

const mockGetDatabase = jest.fn(() => ({
  ref: jest.fn(() => ({
    once: jest.fn().mockResolvedValue({ val: () => null }),
    update: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
}));
jest.unstable_mockModule("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: jest.fn().mockResolvedValue({ uid: "u1" }) }),
}));
jest.unstable_mockModule("../../../utils/auth.js", () => ({
  requireAuth: jest.fn().mockResolvedValue("u1"),
  verifyFirebaseAuth: jest.fn().mockResolvedValue({ ok: true, uid: "u1" }),
}));
jest.unstable_mockModule("firebase-functions/v2/database", () => ({
  onValueWritten: (_opts, handler) => handler,
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
  postFile: mockPostFile,
  escapeDriveQueryValue: (v) => String(v ?? ""),
}));
jest.unstable_mockModule("../../../experiment/sessions/handler.js", () => ({
  handleCreateSession: mockHandleCreateSession,
  handleAppendResult: mockHandleAppendResult,
  handleListSessions: mockHandleListSessions,
  handleDownloadSession: mockHandleDownloadSession,
  handleDeleteSession: mockHandleDeleteSession,
}));

const { apiData } = await import("../../../experiment/sessions/index.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fs.db.batch.mockClear();
  mockWriteLog.mockClear();
  mockGetValidToken.mockReset();
  mockCreateSession.mockReset();
  mockAppendResult.mockReset();
  mockPostFile.mockReset();
  mockHandleCreateSession.mockReset();
  mockHandleAppendResult.mockReset();
  mockHandleListSessions.mockReset();
  mockHandleDownloadSession.mockReset();
  mockHandleDeleteSession.mockReset();
});

// ─── action dispatch ───────────────────────────────────────────────────────

// ─── updateSessionName ─────────────────────────────────────────────────────

// ─── createSession / appendResult routing (no action) ──────────────────────

// ─── handlePostFile (legacy fallback) ──────────────────────────────────────

describe("apiData — updateSessionName", () => {
  // T-2: updateSessionName is now an admin action — requires owner match.
  function mockOwnedExperiment() {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ owner: "u1" }),
    });
  }

  test("400 when sessionName missing", async () => {
    mockOwnedExperiment();
    const res = makeRes();
    await apiData(
      makeReq({
        body: {
          action: "updateSessionName",
          experimentID: "EID",
          sessionId: "S1",
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toMatch(/sessionName/);
  });

  test("happy path → set on session_metadata with merge, returns 200", async () => {
    mockOwnedExperiment();
    const res = makeRes();
    await apiData(
      makeReq({
        body: {
          action: "updateSessionName",
          experimentID: "EID",
          sessionId: "S1",
          sessionName: "Pilot run",
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.success).toBe(true);
    const metaRef = fs.getRef("experiments/EID/session_metadata/S1");
    expect(metaRef.set).toHaveBeenCalledWith(
      { sessionName: "Pilot run" },
      { merge: true },
    );
  });

  test("T-11 FIX: set throws → generic 500 (no error.message leak)", async () => {
    mockOwnedExperiment();
    fs.getRef("experiments/EID/session_metadata/S1").set.mockRejectedValueOnce(
      new Error("boom"),
    );
    const res = makeRes();
    await apiData(
      makeReq({
        body: {
          action: "updateSessionName",
          experimentID: "EID",
          sessionId: "S1",
          sessionName: "X",
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.error).toBe("Internal server error");
  });
});
