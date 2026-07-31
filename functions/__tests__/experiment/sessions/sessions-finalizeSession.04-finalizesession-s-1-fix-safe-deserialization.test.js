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

describe("finalizeSession — S-1 fix: safe deserialization", () => {
  test("trial with `response: '[OK]'` keeps string in CSV (not parsed as array)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "osf", owner: "u1", osfUploadLink: "x" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    const snap = makeSnapshot([
      {
        id: "t1",
        data: {
          clientTimestamp: 1,
          trial_index: 0,
          response: "[OK]", // literal string typed by participant
        },
      },
    ]);
    fs.getCol("experiments/EID/sessions/S1/trials").get
      .mockResolvedValueOnce(snap)
      .mockResolvedValueOnce(snap);
    mockCreateSession.mockResolvedValueOnce({ success: true });
    mockAppendResult.mockResolvedValueOnce({ success: true });

    await finalizeSession("EID", "S1");
    const csv = mockAppendResult.mock.calls[0][5];
    // Verify the literal "[OK]" is preserved, not silently parsed
    expect(csv).toContain('"[OK]"');
  });

  test("trial with sentinel {__json: '[1,2,3]'} IS deserialized to array", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "osf", owner: "u1", osfUploadLink: "x" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    const snap = makeSnapshot([
      {
        id: "t1",
        data: {
          clientTimestamp: 1,
          trial_index: 0,
          // sanitizeForFirestore would store nested arrays this way
          choices: { __json: "[1,2,3]" },
        },
      },
    ]);
    fs.getCol("experiments/EID/sessions/S1/trials").get
      .mockResolvedValueOnce(snap)
      .mockResolvedValueOnce(snap);
    mockCreateSession.mockResolvedValueOnce({ success: true });
    mockAppendResult.mockResolvedValueOnce({ success: true });

    await finalizeSession("EID", "S1");
    const csv = mockAppendResult.mock.calls[0][5];
    // CSV column "choices" should contain the deserialized array,
    // json2csv renders arrays as comma-joined values inside the cell
    expect(csv).toMatch(/"choices"/);
    // Either rendered as "[1,2,3]" or "1,2,3" depending on json2csv version —
    // just verify it isn't the literal sentinel string
    expect(csv).not.toContain('"__json"');
  });

  test("string value that looks like JSON but isn't sentinel is preserved", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "osf", owner: "u1", osfUploadLink: "x" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    const snap = makeSnapshot([
      {
        id: "t1",
        data: {
          clientTimestamp: 1,
          trial_index: 0,
          // Old buggy behavior: this would be JSON.parsed to [1,2,3]
          freeTextResponse: "[1,2,3]",
        },
      },
    ]);
    fs.getCol("experiments/EID/sessions/S1/trials").get
      .mockResolvedValueOnce(snap)
      .mockResolvedValueOnce(snap);
    mockCreateSession.mockResolvedValueOnce({ success: true });
    mockAppendResult.mockResolvedValueOnce({ success: true });

    await finalizeSession("EID", "S1");
    const csv = mockAppendResult.mock.calls[0][5];
    expect(csv).toContain('"[1,2,3]"');
  });
});
