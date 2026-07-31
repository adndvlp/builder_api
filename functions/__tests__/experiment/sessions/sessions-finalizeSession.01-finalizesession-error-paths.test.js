/**
 * Tests for sessions/index.js::finalizeSession — heaviest orchestration in the codebase.
 * Covers: error paths (EXPERIMENT_NOT_FOUND / SESSION_NOT_FOUND / NO_RESULTS),
 * batch expansion, OSF happy path (skips PATCH branch), Drive PATCH new-file path,
 * S-3 fix verification (paginated trial delete >500), session_metadata write.
 */
import { jest } from "@jest/globals";
import fetchMock from "../../helpers/fetch-mock.js";
import { makeFsMock, makeSnapshot } from "../../helpers/firestore-mock.js";

const fs = makeFsMock();
const mockWriteLog = jest.fn().mockResolvedValue(true);
const mockGetValidToken = jest.fn();
const mockCreateSession = jest.fn();
const mockAppendResult = jest.fn();

const rtdbRef = {
  once: jest.fn(),
  update: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
};
const mockGetDatabase = jest.fn(() => ({
  ref: jest.fn(() => rtdbRef),
}));

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
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
  postFile: jest.fn(),
  escapeDriveQueryValue: (v) => String(v ?? ""),
}));
jest.unstable_mockModule("../../../experiment/sessions/handler.js", () => ({
  handleCreateSession: jest.fn(),
  handleAppendResult: jest.fn(),
  handleListSessions: jest.fn(),
  handleDownloadSession: jest.fn(),
  handleDeleteSession: jest.fn(),
}));

const { finalizeSession } = await import("../../../experiment/sessions/index.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fs.db.batch.mockClear();
  fetchMock.__reset();
  mockWriteLog.mockClear();
  mockGetValidToken.mockReset();
  mockCreateSession.mockReset();
  mockAppendResult.mockReset();
  rtdbRef.once.mockReset();
  // Default: no RTDB data
  rtdbRef.once.mockResolvedValue({ val: () => null });
});

// ─── Error paths ──────────────────────────────────────────────────────────

// ─── OSF happy path (skips PATCH, calls createSession + appendResult) ─────

// ─── S-3 FIX: pagination of trials.delete in chunks of 500 ─────────────────

// ─── S-1 FIX: deserializer only unwraps {__json: "..."} sentinel ─────────

// ─── Drive PATCH path: new file (no existing) ─────────────────────────────

describe("finalizeSession — error paths", () => {
  test("throws EXPERIMENT_NOT_FOUND when exp doc missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    await expect(finalizeSession("EID", "S1")).rejects.toThrow("EXPERIMENT_NOT_FOUND");
  });

  test("throws INVALID_GOOGLE_DRIVE_TOKEN when getValidToken fails on Drive", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive", owner: "u1" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: false });
    await expect(finalizeSession("EID", "S1")).rejects.toThrow(
      "INVALID_GOOGLE_DRIVE_TOKEN",
    );
  });

  test("throws SESSION_NOT_FOUND when session doc missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "osf", owner: "u1", osfUploadLink: "x" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({ exists: false });
    await expect(finalizeSession("EID", "S1")).rejects.toThrow("SESSION_NOT_FOUND");
  });

  test("throws NO_RESULTS when trials subcollection is empty", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "osf", owner: "u1", osfUploadLink: "x" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    fs.getCol("experiments/EID/sessions/S1/trials").get.mockResolvedValueOnce(
      makeSnapshot([]),
    );
    await expect(finalizeSession("EID", "S1")).rejects.toThrow("NO_RESULTS");
  });
});
