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

describe("handleAppendResult — error branches", () => {
  test("returns 400 DATA_COLLECTION_NOT_ACTIVE when active=false", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: false }),
    });
    const res = makeRes();
    await handleAppendResult(makeReq({}), res, "EID", "S1", { trial_index: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("DATA_COLLECTION_NOT_ACTIVE");
  });

  test("returns 400 when data is a string with invalid JSON", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, useValidation: false }),
    });
    const res = makeRes();
    await handleAppendResult(makeReq({}), res, "EID", "S1", "not-json-{");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Invalid JSON/);
  });

  test("returns 400 INVALID_DATA when validateJSON fails (useValidation+allowJSON)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        useValidation: true,
        allowJSON: true,
        requiredFields: ["foo", "bar"],
      }),
    });
    const res = makeRes();
    await handleAppendResult(makeReq({}), res, "EID", "S1", { other: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("INVALID_DATA");
  });

  test("returns 400 INVALID_DATA when useValidation is on but allowJSON is off", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        useValidation: true,
        allowJSON: false,
        requiredFields: ["foo"],
      }),
    });
    const res = makeRes();
    await handleAppendResult(makeReq({}), res, "EID", "S1", { foo: "v" });
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("INVALID_DATA");
  });

  test("useValidation+allowJSON: passes when required fields present", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        useValidation: true,
        allowJSON: true,
        requiredFields: ["foo"],
      }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
    });
    const res = makeRes();
    await handleAppendResult(
      makeReq({}),
      res,
      "EID",
      "S1",
      { foo: "v", clientTimestamp: 1, trial_index: 0 },
    );
    expect(res.statusCode).toBe(201);
  });

  test("validation is SKIPPED for concatenated batches (allowJSON off would otherwise fail)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        useValidation: true,
        allowJSON: false, // would normally fail validation
        requiredFields: ["foo"],
      }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
    });
    const res = makeRes();
    await handleAppendResult(makeReq({}), res, "EID", "S1", {
      batchNumber: 1,
      firstTrialIndex: 0,
      trialsCount: 2,
      trialsData: "[{}]",
    });
    expect(res.statusCode).toBe(201);
  });

  test("missing clientTimestamp gets server-side fallback before computing trialId", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, useValidation: false }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
    });
    const before = Date.now();
    const res = makeRes();
    await handleAppendResult(makeReq({}), res, "EID", "S1", {
      trial_index: 7,
      response: "x",
    });
    const after = Date.now();
    expect(res.statusCode).toBe(201);
    const trialsCol = fs.getCol("experiments/EID/sessions/S1/trials");
    // H-6: trialId pattern is `${ts}_${idx}_${uniqueSuffix}`. First doc() call
    // generates the suffix (no args); second uses the composed id.
    const composedId = trialsCol.doc.mock.calls[1][0];
    expect(composedId).toMatch(/^\d+_7_/);
    const ts = Number(composedId.split("_")[0]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("string data parsed via JSON.parse hits the same trial path", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, useValidation: false }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
    });
    const res = makeRes();
    await handleAppendResult(
      makeReq({}),
      res,
      "EID",
      "S1",
      JSON.stringify({ clientTimestamp: 99, trial_index: 2, x: 1 }),
    );
    expect(res.statusCode).toBe(201);
    const trialsCol = fs.getCol("experiments/EID/sessions/S1/trials");
    const composedId = trialsCol.doc.mock.calls[1][0];
    expect(composedId).toMatch(/^99_2_/);
  });

  test("nested array under a key → sanitized into {__json} sentinel", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, useValidation: false }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
    });

    const res = makeRes();
    await handleAppendResult(makeReq({}), res, "EID", "S1", {
      clientTimestamp: 100,
      trial_index: 0,
      response: [[1, 2], [3, 4]],
    });

    const trialsCol = fs.getCol("experiments/EID/sessions/S1/trials");
    const composedId = trialsCol.doc.mock.calls[1][0];
    expect(composedId).toMatch(/^100_0_/);
    const trialRef = fs.getRef(
      `experiments/EID/sessions/S1/trials/${composedId}`,
    );
    const setArg = trialRef.set.mock.calls[0][0];
    expect(setArg.response).toEqual({ __json: JSON.stringify([[1, 2], [3, 4]]) });
  });

  test("session doc auto-update increments trialCount when session already exists", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, useValidation: false }),
    });
    const sessionRef = fs.getRef("experiments/EID/sessions/S1");
    sessionRef.get.mockResolvedValueOnce({ exists: true });
    const res = makeRes();
    await handleAppendResult(makeReq({}), res, "EID", "S1", {
      clientTimestamp: 1,
      trial_index: 0,
    });
    expect(sessionRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ trialCount: expect.anything() }),
    );
  });

  test("returns 500 with error message when initial exp.get rejects", async () => {
    fs.getRef("experiments/EID").get.mockRejectedValueOnce(new Error("fs boom"));
    const res = makeRes();
    await handleAppendResult(makeReq({}), res, "EID", "S1", { x: 1 });
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.message).toBe("Internal server error");
    expect(res.jsonBody.error).toBeUndefined();
  });
});

// ─── handleListSessions ───────────────────────────────────────────────────
