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

describe("apiData — handlePostFile (legacy)", () => {
  test("missing required params → 400 MISSING_PARAMETER", async () => {
    const res = makeRes();
    await apiData(makeReq({ body: { experimentID: "EID" } }), res);
    expect(res.statusCode).toBe(400);
  });

  test("400 when exp doc missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await apiData(
      makeReq({
        body: { experimentID: "EID", data: "a", filename: "f.csv" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  test("400 when not active", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: false }),
    });
    const res = makeRes();
    await apiData(
      makeReq({
        body: { experimentID: "EID", data: "a", filename: "f.csv" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  test("400 MAX_SESSIONS_REACHED when sessions >= maxSessions", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        limitSessions: true,
        sessions: 5,
        maxSessions: 5,
      }),
    });
    const res = makeRes();
    await apiData(
      makeReq({
        body: { experimentID: "EID", data: "a", filename: "f.csv" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  test("400 INVALID_DATA when useValidation rejects payload", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        useValidation: true,
        allowJSON: true,
        allowCSV: false,
        requiredFields: ["trial_type"],
        storageProvider: "googledrive",
        owner: "u1",
      }),
    });
    // JSON validation fails because the string doesn't parse to an array with
    // trial_type. allowCSV=false → falls through to invalid.
    const res = makeRes();
    await apiData(
      makeReq({
        body: { experimentID: "EID", data: "not-json", filename: "f.csv" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  test("400 INVALID_GOOGLE_DRIVE_TOKEN when getValidToken fails on Drive", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        useValidation: false,
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "fld1",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: false });
    const res = makeRes();
    await apiData(
      makeReq({
        body: { experimentID: "EID", data: "a,b\n1,2", filename: "f.csv" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("INVALID_GOOGLE_DRIVE_TOKEN");
  });

  test("409 FILE_ALREADY_EXISTS when postFile returns errorCode 409", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        useValidation: false,
        storageProvider: "dropbox",
        owner: "u1",
        dropboxFolder: "/X",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "T" });
    mockPostFile.mockResolvedValueOnce({ success: false, errorCode: 409 });
    const res = makeRes();
    await apiData(
      makeReq({
        body: { experimentID: "EID", data: "x", filename: "f.csv" },
      }),
      res,
    );
    expect(res.statusCode).toBe(409);
  });

  test("400 provider upload error when postFile returns failure with no 409", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        useValidation: false,
        storageProvider: "dropbox",
        owner: "u1",
        dropboxFolder: "/X",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "T" });
    mockPostFile.mockResolvedValueOnce({ success: false, errorText: "remote" });
    const res = makeRes();
    await apiData(
      makeReq({
        body: { experimentID: "EID", data: "x", filename: "f.csv" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  test("happy path → postFile called, sessions incremented, 201 SUCCESS", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        useValidation: false,
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "fld1",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "T" });
    mockPostFile.mockResolvedValueOnce({ success: true });

    const res = makeRes();
    await apiData(
      makeReq({
        body: { experimentID: "EID", data: "x", filename: "f.csv" },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(res.jsonBody.message).toBe("Success");
    expect(mockPostFile).toHaveBeenCalledWith(
      "googledrive",
      "T",
      "fld1",
      "x",
      "f.csv",
    );
    // sessions counter incremented
    const expRef = fs.getRef("experiments/EID");
    expect(expRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: expect.objectContaining({ __op: "increment", value: 1 }),
      }),
      { merge: true },
    );
  });
});
