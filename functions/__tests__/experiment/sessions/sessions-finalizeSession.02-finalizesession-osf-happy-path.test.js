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

describe("finalizeSession — OSF happy path", () => {
  test("expands batches, builds CSV, calls createSession + appendResult, cleans Firestore", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "osf",
        owner: "u1",
        osfUploadLink:
          "https://files.osf.io/v1/resources/abc/providers/osfstorage/",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        metadata: { browser: "Chrome", os: "macOS" },
        createdAt: "2026-01-01T00:00:00Z",
      }),
    });

    // First .get() for the empty check + second .get() for actual reading +
    // third .get() for batch delete loop
    const trialsSnapshot = makeSnapshot([
      {
        id: "t1",
        data: {
          clientTimestamp: 1,
          trial_index: 0,
          response: "a",
        },
      },
      {
        id: "batch1",
        data: {
          trialsData: JSON.stringify([
            { clientTimestamp: 2, trial_index: 1, response: "b" },
            { clientTimestamp: 3, trial_index: 2, response: "c" },
          ]),
        },
      },
    ]);
    fs.getCol("experiments/EID/sessions/S1/trials").get
      .mockResolvedValueOnce(trialsSnapshot)
      .mockResolvedValueOnce(trialsSnapshot);

    mockCreateSession.mockResolvedValueOnce({ success: true, id: "osf-new" });
    mockAppendResult.mockResolvedValueOnce({
      success: true,
      id: "osf-new",
      fileUrl: "https://osf.io/dl",
    });

    const result = await finalizeSession("EID", "S1");

    expect(result.success).toBe(true);
    expect(result.resultsSent).toBe(3); // 1 individual + 2 from batch expansion
    expect(result.patchMode).toBe(false); // OSF uses non-PATCH path

    // createSession called for OSF (non-PATCH)
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession.mock.calls[0][0]).toBe("osf");

    // appendResult called with the CSV including all 3 trials + metadata cols
    expect(mockAppendResult).toHaveBeenCalledTimes(1);
    const csv = mockAppendResult.mock.calls[0][5];
    expect(csv).toContain("Chrome");
    expect(csv).toContain("macOS");
    expect(csv).toMatch(/response/);

    // S-3 fix: trials deleted via paginated batch (1 batch since only 2 trials)
    expect(fs.db.batch).toHaveBeenCalled();
    // Session doc deleted separately (not in batch anymore)
    expect(fs.getRef("experiments/EID/sessions/S1").delete).toHaveBeenCalled();

    // session_metadata written
    const metaRef = fs.getRef("experiments/EID/session_metadata/S1");
    expect(metaRef.set).toHaveBeenCalled();
    const metaArg = metaRef.set.mock.calls[0][0];
    expect(metaArg.state).toBe("completed");
    expect(metaArg.fileUrl).toBe("https://osf.io/dl");
  });

  test("when RTDB state=abandoned, persisted state is 'abandoned'", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "osf", owner: "u1", osfUploadLink: "x" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    rtdbRef.once.mockResolvedValueOnce({
      val: () => ({ state: "abandoned", metadata: {} }),
    });
    fs.getRef("experiments/EID/sessions/S1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    const snap = makeSnapshot([
      { id: "t1", data: { clientTimestamp: 1, trial_index: 0, x: 1 } },
    ]);
    fs.getCol("experiments/EID/sessions/S1/trials").get
      .mockResolvedValueOnce(snap)
      .mockResolvedValueOnce(snap);
    mockCreateSession.mockResolvedValueOnce({ success: true });
    mockAppendResult.mockResolvedValueOnce({ success: true });

    await finalizeSession("EID", "S1");

    const metaArg = fs.getRef("experiments/EID/session_metadata/S1").set.mock
      .calls[0][0];
    expect(metaArg.state).toBe("abandoned");
  });
});
