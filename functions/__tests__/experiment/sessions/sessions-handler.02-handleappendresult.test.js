/**
 * Tests for experiment/sessions/handler.js — the 5 session lifecycle handlers.
 * Each handler is a thin layer over Firestore + a storage provider. Mocks isolate
 * the layer being verified.
 */
import { jest } from "@jest/globals";
import { makeFsMock, makeReq, makeRes, makeSnapshot } from "../../helpers/firestore-mock.js";

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
  // unused but exported by the real module
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
  fs.db.collection.mockClear();
  fs.db.runTransaction.mockClear();
  mockWriteLog.mockClear();
  mockGetValidToken.mockReset();
  mockListSessions.mockReset();
  mockDownloadSession.mockReset();
  mockDeleteSession.mockReset();
});

// ─── handleCreateSession ──────────────────────────────────────────────────

// ─── handleAppendResult ───────────────────────────────────────────────────

// ─── handleListSessions (T-14 verification) ───────────────────────────────

// ─── handleDownloadSession + handleDeleteSession ──────────────────────────

describe("handleAppendResult", () => {
  test("returns 400 if exp doesn't exist", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await handleAppendResult(
      makeReq({ body: { experimentID: "EID", sessionId: "S1", data: {} } }),
      res,
      "EID",
      "S1",
      {},
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("EXPERIMENT_NOT_FOUND");
  });

  test("stores single trial as doc in sessions/<sid>/trials/<trialId> (H-6 unique suffix)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, useValidation: false }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({ exists: true });

    const res = makeRes();
    await handleAppendResult(
      makeReq({}),
      res,
      "EID",
      "S1",
      { clientTimestamp: 1700000000000, trial_index: 5, response: "x" },
    );

    expect(res.statusCode).toBe(201);
    // H-6/H-7: trialId pattern is `${ts}_${idx}_${firestoreAutoId}` to prevent
    // collisions between concurrent or buggy clients.
    const trialsCol = fs.getCol("experiments/EID/sessions/S1/trials");
    expect(trialsCol.doc).toHaveBeenCalled();
    const docCalls = trialsCol.doc.mock.calls;
    // One call with no args (suffix generation) + one with the composed id
    const composedIdCall = docCalls.find((args) => args[0]?.startsWith("1700000000000_5_"));
    expect(composedIdCall).toBeDefined();
  });

  test("H-3 FIX: when creating session doc via append, createdAt is ISO string (not Timestamp)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, useValidation: false }),
    });
    const sessionRef = fs.getRef("experiments/EID/sessions/S1");
    sessionRef.get.mockResolvedValueOnce({ exists: false }); // doc didn't exist

    const res = makeRes();
    await handleAppendResult(
      makeReq({}),
      res,
      "EID",
      "S1",
      { clientTimestamp: 1, trial_index: 0, x: 1 },
    );

    // session_ref.set called with createdAt as a STRING (not Firestore sentinel)
    expect(sessionRef.set).toHaveBeenCalledTimes(1);
    const setArg = sessionRef.set.mock.calls[0][0];
    expect(typeof setArg.createdAt).toBe("string");
    // ISO format check
    expect(setArg.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  test("batches concatenated trials get trialId=batch_N_firstIndex_<suffix> (H-7)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, useValidation: false }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({ exists: true });

    const res = makeRes();
    await handleAppendResult(
      makeReq({}),
      res,
      "EID",
      "S1",
      {
        batchNumber: 3,
        trialsCount: 10,
        firstTrialIndex: 20,
        trialsData: '[{"t":1}]',
      },
    );

    expect(res.statusCode).toBe(201);
    const trialsCol = fs.getCol("experiments/EID/sessions/S1/trials");
    const composedIdCall = trialsCol.doc.mock.calls.find((args) =>
      args[0]?.startsWith("batch_3_20_"),
    );
    expect(composedIdCall).toBeDefined();
  });
});
