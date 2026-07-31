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

describe("apiData — action dispatch", () => {
  // T-2: admin actions require Firebase Auth + ownership match. Mock the
  // experiment doc to exist with owner=u1 (auth mock returns "u1").
  function mockOwnedExperiment() {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ owner: "u1" }),
    });
  }

  test("action=list → handleListSessions(req,res,experimentID)", async () => {
    mockOwnedExperiment();
    const res = makeRes();
    const req = makeReq({ body: { action: "list", experimentID: "EID" } });
    await apiData(req, res);
    expect(mockHandleListSessions).toHaveBeenCalledWith(req, res, "EID");
  });

  test("action=download → handleDownloadSession(req,res,experimentID,sessionId)", async () => {
    mockOwnedExperiment();
    const res = makeRes();
    const req = makeReq({
      body: { action: "download", experimentID: "EID", sessionId: "S1" },
    });
    await apiData(req, res);
    expect(mockHandleDownloadSession).toHaveBeenCalledWith(req, res, "EID", "S1");
  });

  test("action=delete → handleDeleteSession(req,res,experimentID,sessionId)", async () => {
    mockOwnedExperiment();
    const res = makeRes();
    const req = makeReq({
      body: { action: "delete", experimentID: "EID", sessionId: "S1" },
    });
    await apiData(req, res);
    expect(mockHandleDeleteSession).toHaveBeenCalledWith(req, res, "EID", "S1");
  });

  test("T-2 FIX: admin action denied when authed user is not the experiment owner", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ owner: "otherUser" }),
    });
    const res = makeRes();
    await apiData(
      makeReq({ body: { action: "list", experimentID: "EID" } }),
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(mockHandleListSessions).not.toHaveBeenCalled();
  });

  test("action=finish + finalizeSession EXPERIMENT_NOT_FOUND → 400 via handleFinalizationError", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await apiData(
      makeReq({
        body: { action: "finish", experimentID: "EID", sessionId: "S1" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("EXPERIMENT_NOT_FOUND");
  });
});
