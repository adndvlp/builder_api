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

describe("handleDownloadSession + handleDeleteSession routing", () => {
  test("download: sets CSV headers and sends body on success", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "dropbox", owner: "u1", dropboxFolder: "/exp" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockDownloadSession.mockResolvedValueOnce({ success: true, csv: "col\n1" });

    const res = makeRes();
    await handleDownloadSession(makeReq({}), res, "EID", "S1");
    expect(res.headers["Content-Type"]).toBe("text/csv");
    expect(res.headers["Content-Disposition"]).toContain("EID_S1.csv");
    expect(res.statusCode).toBe(200);
    expect(res.sentBody).toBe("col\n1");
  });

  test("delete: decrements experiment.sessions counter on success (H-5: floored at 0)", async () => {
    const expRef = fs.getRef("experiments/EID");
    expRef.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "dropbox", owner: "u1", dropboxFolder: "/exp" }),
    });
    // Decrement txn reads the current value from expRef.get
    expRef.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ sessions: 3 }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockDeleteSession.mockResolvedValueOnce({ success: true });

    const res = makeRes();
    await handleDeleteSession(makeReq({}), res, "EID", "S1");
    expect(res.statusCode).toBe(200);
    // H-5: now uses runTransaction wrapping the set on expRef. The mock
    // forwards t.set to ref.set so the original assertion still holds.
    expect(expRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ sessions: 2 }),
      { merge: true },
    );
  });

  test("H-5 FIX: delete doesn't drive sessions counter below 0", async () => {
    const expRef = fs.getRef("experiments/EID");
    expRef.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "dropbox", owner: "u1", dropboxFolder: "/exp" }),
    });
    expRef.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ sessions: 0 }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockDeleteSession.mockResolvedValueOnce({ success: true });

    const res = makeRes();
    await handleDeleteSession(makeReq({}), res, "EID", "S1");
    expect(res.statusCode).toBe(200);
    expect(expRef.set).toHaveBeenCalledWith(
      { sessions: 0 },
      { merge: true },
    );
  });
});
