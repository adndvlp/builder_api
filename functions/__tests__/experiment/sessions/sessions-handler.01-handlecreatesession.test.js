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

describe("handleCreateSession", () => {
  test("returns 400 EXPERIMENT_NOT_FOUND if exp doc missing", async () => {
    const expRef = fs.getRef("experiments/EID");
    expRef.get.mockResolvedValueOnce({ exists: false });
    const req = makeReq({ body: { experimentID: "EID", sessionId: "S1" } });
    const res = makeRes();
    await handleCreateSession(req, res, "EID", "S1");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("EXPERIMENT_NOT_FOUND");
  });

  test("returns 400 if experiment not active", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: false }),
    });
    const res = makeRes();
    await handleCreateSession(makeReq({ body: {} }), res, "EID", "S1");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("DATA_COLLECTION_NOT_ACTIVE");
  });

  test("returns 200 with participantNumber from existing session (resume)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, activeConditionAssignment: true, nConditions: 1 }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ participantNumber: 42 }),
    });
    const res = makeRes();
    await handleCreateSession(makeReq({ body: {} }), res, "EID", "S1");
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({
      success: true,
      sessionId: "S1",
      participantNumber: 42,
    });
  });

  test("creates fresh session, assigns participantNumber=0 first time, increments currentCondition", async () => {
    const expRef = fs.getRef("experiments/EID");
    const sessionRef = fs.getRef("experiments/EID/sessions/S1");

    expRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        active: true,
        activeConditionAssignment: true,
        nConditions: 3,
        currentCondition: 0,
      }),
    });
    sessionRef.get.mockResolvedValueOnce({ exists: false });

    const res = makeRes();
    await handleCreateSession(
      makeReq({ body: { batchSize: 10 } }),
      res,
      "EID",
      "S1",
    );

    expect(res.statusCode).toBe(201);
    expect(res.jsonBody.participantNumber).toBe(0); // pre-increment value

    // txn ran and set incremented currentCondition
    expect(fs.db.runTransaction).toHaveBeenCalledTimes(1);
    // batchSize>0 → session doc was created
    expect(sessionRef.set).toHaveBeenCalled();
    const setArg = sessionRef.set.mock.calls[0][0];
    expect(setArg.participantNumber).toBe(0);
    expect(setArg.sessionId).toBe("S1");

    // sessions counter incremented on experiment doc
    expect(expRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ sessions: expect.anything() }),
      { merge: true },
    );
  });

  test("when batchSize=0 does NOT create Firestore session doc (data goes straight to storage at end)", async () => {
    const expRef = fs.getRef("experiments/EID");
    const sessionRef = fs.getRef("experiments/EID/sessions/S1");
    expRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        active: true,
        activeConditionAssignment: true,
        nConditions: 1,
        currentCondition: 0,
      }),
    });
    sessionRef.get.mockResolvedValueOnce({ exists: false });

    const res = makeRes();
    await handleCreateSession(
      makeReq({ body: { batchSize: 0 } }),
      res,
      "EID",
      "S1",
    );

    expect(res.statusCode).toBe(201);
    expect(sessionRef.set).not.toHaveBeenCalled();
    // experiment sessions counter still incremented
    expect(expRef.set).toHaveBeenCalled();
  });

  test("H-11 FIX: activeConditionAssignment=false still assigns participantNumber (monotonic counter)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, activeConditionAssignment: false }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({ exists: false });
    // txn reads exp doc and writes new currentCondition
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ activeConditionAssignment: false, currentCondition: 7 }),
    });
    const res = makeRes();
    await handleCreateSession(makeReq({ body: {} }), res, "EID", "S1");
    expect(res.statusCode).toBe(201);
    expect(res.jsonBody.participantNumber).toBe(7);
  });
});
