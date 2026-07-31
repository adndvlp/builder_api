/**
 * Tier 3 — error/branch coverage for experiment/sessions/handler.js.
 *
 * Targets the uncovered paths flagged in `npm run test:coverage`:
 *   - MAX_SESSIONS_REACHED, txn failure → UNKNOWN_ERROR_GETTING_CONDITION
 *   - sessionName session_metadata write (happy + swallowed error)
 *   - outer try/catch (500) for all 5 handlers
 *   - handleAppendResult: DATA_COLLECTION_NOT_ACTIVE, invalid JSON string,
 *     validation pass/fail, missing-clientTimestamp fallback, nested-array sentinel
 *   - handleListSessions: EXPERIMENT_NOT_FOUND, !result.success, drive/dropbox token errors
 *   - handleDownloadSession: EXPERIMENT_NOT_FOUND, all 3 token-error variants,
 *     `.error` fallback when storage returns no `errorText`
 *   - handleDeleteSession: EXPERIMENT_NOT_FOUND, 2 missing token-error variants,
 *     storage failure → 400
 */
import { jest } from "@jest/globals";
import { makeFsMock, makeReq, makeRes } from "../../helpers/firestore-mock.js";

const fs = makeFsMock();
const mockWriteLog = jest.fn().mockResolvedValue(true);
const mockGetValidToken = jest.fn();
const mockListSessions = jest.fn();
const mockDownloadSession = jest.fn();
const mockDeleteSession = jest.fn();

jest.unstable_mockModule("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (n) => ({ __op: "increment", value: n }),
    serverTimestamp: () => ({ __op: "serverTimestamp" }),
    arrayUnion: (...args) => ({ __op: "arrayUnion", args }),
  },
}));
jest.unstable_mockModule("../../../app.js", () => ({ db: fs.db, app: {} }));
jest.unstable_mockModule("../../../experiment/sessions/logging/write-log.js", () => ({
  default: mockWriteLog,
}));
jest.unstable_mockModule("../../../oauth/index.js", () => ({
  getValidToken: mockGetValidToken,
}));
jest.unstable_mockModule("../../../experiment/sessions/storage.js", () => ({
  listSessions: mockListSessions,
  downloadSession: mockDownloadSession,
  deleteSession: mockDeleteSession,
  createSession: jest.fn(),
  appendResult: jest.fn(),
  postFile: jest.fn(),
  escapeDriveQueryValue: (v) => String(v ?? ""),
}));

const {
  handleCreateSession,
  handleAppendResult,
  handleListSessions,
  handleDownloadSession,
  handleDeleteSession,
} = await import("../../../experiment/sessions/handler.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fs.db.runTransaction.mockClear();
  mockWriteLog.mockClear();
  mockGetValidToken.mockReset();
  mockListSessions.mockReset();
  mockDownloadSession.mockReset();
  mockDeleteSession.mockReset();
});

// ─── handleCreateSession ──────────────────────────────────────────────────

describe("handleListSessions — error branches", () => {
  test("returns 400 EXPERIMENT_NOT_FOUND when exp doc missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("EXPERIMENT_NOT_FOUND");
  });

  test("dropbox token failure → INVALID_DROPBOX_TOKEN", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "dropbox", owner: "u1" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: false });
    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("INVALID_DROPBOX_TOKEN");
  });

  test("googledrive token failure → INVALID_GOOGLE_DRIVE_TOKEN", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive", owner: "u1" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: false });
    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("INVALID_GOOGLE_DRIVE_TOKEN");
  });

  test("returns 400 with provider errorText when storage.listSessions fails", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "fid",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    mockListSessions.mockResolvedValueOnce({
      success: false,
      errorText: "API down",
    });
    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toBe("API down");
  });

  test("returns 400 with default message when storage.listSessions fails without errorText", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "fid",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    mockListSessions.mockResolvedValueOnce({ success: false });
    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toBe("Error listing sessions");
  });

  test("returns 500 when expRef.get throws", async () => {
    fs.getRef("experiments/EID").get.mockRejectedValueOnce(new Error("fs boom"));
    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.message).toBe("Internal server error");
    expect(res.jsonBody.error).toBeUndefined();
  });
});

// ─── handleDownloadSession ───────────────────────────────────────────────
