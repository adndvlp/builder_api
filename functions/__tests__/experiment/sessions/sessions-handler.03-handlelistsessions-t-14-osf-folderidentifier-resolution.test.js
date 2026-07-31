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

describe("handleListSessions — T-14 OSF folderIdentifier resolution", () => {
  test("for OSF passes osfComponentId (NOT osfUploadLink) to storage.listSessions", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "osf",
        owner: "u1",
        osfComponentId: "abc123",
        osfUploadLink:
          "https://files.osf.io/v1/resources/abc123/providers/osfstorage/",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockListSessions.mockResolvedValueOnce({ success: true, sessions: [] });

    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");

    expect(mockListSessions).toHaveBeenCalledWith(
      "osf",
      "tok",
      "abc123", // ← T-14 fix: componentId, not uploadLink
      "EID",
    );
    expect(res.statusCode).toBe(200);
  });

  test("for OSF, falls back to extracting componentId from osfUploadLink when osfComponentId missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "osf",
        owner: "u1",
        // osfComponentId NOT set (legacy experiments)
        osfUploadLink:
          "https://files.osf.io/v1/resources/legacy999/providers/osfstorage/",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockListSessions.mockResolvedValueOnce({ success: true, sessions: [] });

    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");

    expect(mockListSessions).toHaveBeenCalledWith("osf", "tok", "legacy999", "EID");
  });

  test("for googledrive passes driveFolderId unchanged", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "folder123",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockListSessions.mockResolvedValueOnce({ success: true, sessions: [{ id: "s1" }] });

    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");

    expect(mockListSessions).toHaveBeenCalledWith(
      "googledrive",
      "tok",
      "folder123",
      "EID",
    );
    expect(res.jsonBody.sessions).toEqual([{ id: "s1" }]);
  });

  test("returns 400 with provider-specific token error message on token failure", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "osf", owner: "u1", osfComponentId: "c1" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: false, error: "noTok" });
    const res = makeRes();
    await handleListSessions(makeReq({}), res, "EID");
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("INVALID_OSF_TOKEN");
  });
});
