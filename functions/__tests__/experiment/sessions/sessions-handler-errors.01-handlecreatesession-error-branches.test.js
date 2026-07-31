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

describe("handleCreateSession — error branches", () => {
  test("returns 400 MAX_SESSIONS_REACHED when limit on and counter ≥ max", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        limitSessions: true,
        sessions: 10,
        maxSessions: 10,
      }),
    });
    const res = makeRes();
    await handleCreateSession(makeReq({ body: {} }), res, "EID", "S1");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("MAX_SESSIONS_REACHED");
  });

  test("returns 400 UNKNOWN_ERROR_GETTING_CONDITION when txn rejects", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        activeConditionAssignment: true,
        nConditions: 1,
      }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: false,
    });
    fs.db.runTransaction.mockImplementationOnce(async () => {
      throw new Error("txn rejected");
    });
    const res = makeRes();
    await handleCreateSession(
      makeReq({ body: { batchSize: 5 } }),
      res,
      "EID",
      "S1",
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("UNKNOWN_ERROR_GETTING_CONDITION");
  });

  test("writes session_metadata when sessionName provided", async () => {
    const expRef = fs.getRef("experiments/EID");
    const sessionRef = fs.getRef("experiments/EID/sessions/S1");
    expRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        active: true,
        activeConditionAssignment: true,
        nConditions: 1,
      }),
    });
    sessionRef.get.mockResolvedValueOnce({ exists: false });

    const res = makeRes();
    await handleCreateSession(
      makeReq({ body: { batchSize: 5, sessionName: "Pilot subject A" } }),
      res,
      "EID",
      "S1",
    );
    expect(res.statusCode).toBe(201);
    const metaRef = fs.getRef("experiments/EID/session_metadata/S1");
    expect(metaRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "S1",
        sessionName: "Pilot subject A",
        createdAt: expect.any(String),
      }),
      { merge: true },
    );
  });

  test("swallows session_metadata write error and still returns 201", async () => {
    const expRef = fs.getRef("experiments/EID");
    const sessionRef = fs.getRef("experiments/EID/sessions/S1");
    expRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        active: true,
        activeConditionAssignment: true,
        nConditions: 1,
      }),
    });
    sessionRef.get.mockResolvedValueOnce({ exists: false });
    fs.getRef("experiments/EID/session_metadata/S1").set.mockRejectedValueOnce(
      new Error("meta boom"),
    );

    const res = makeRes();
    await handleCreateSession(
      makeReq({ body: { batchSize: 5, sessionName: "Subject B" } }),
      res,
      "EID",
      "S1",
    );
    expect(res.statusCode).toBe(201);
  });

  test("T-11 FIX: returns generic 500 (does not leak error.message) when initial exp.get rejects", async () => {
    fs.getRef("experiments/EID").get.mockRejectedValueOnce(new Error("fs down"));
    const res = makeRes();
    await handleCreateSession(makeReq({ body: {} }), res, "EID", "S1");
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.message).toBe("Internal server error");
    expect(res.jsonBody.error).toBeUndefined();
  });
});

// ─── handleAppendResult ───────────────────────────────────────────────────
