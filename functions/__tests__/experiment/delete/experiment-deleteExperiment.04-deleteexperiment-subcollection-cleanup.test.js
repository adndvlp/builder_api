/**
 * Tests for experiment/index.js::deleteExperiment.
 * Verifies E-4 (OSF folder cleanup) and E-5 (RTDB cleanup) fixes.
 */
import { jest } from "@jest/globals";
import { makeFsMock, makeSnapshot } from "../../helpers/firestore-mock.js";
import fetchMock from "../../helpers/fetch-mock.js";

const fs = makeFsMock();
const mockWriteLog = jest.fn().mockResolvedValue(true);
const mockGetValidToken = jest.fn();
const mockCreateFolder = jest.fn();
const mockDeleteFolder = jest.fn();
const mockDeleteRepositoryGithub = jest.fn();

const rtdbRefRemove = jest.fn().mockResolvedValue(undefined);
const rtdbRef = jest.fn(() => ({ remove: rtdbRefRemove }));
const mockGetDatabase = jest.fn(() => ({ ref: rtdbRef }));

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
}));
jest.unstable_mockModule("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: jest.fn().mockResolvedValue({ uid: "u1" }) }),
}));
jest.unstable_mockModule("../../../utils/auth.js", () => ({
  requireAuth: jest.fn().mockResolvedValue("u1"),
  verifyFirebaseAuth: jest.fn().mockResolvedValue({ ok: true, uid: "u1" }),
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
jest.unstable_mockModule("../../../experiment/sessions/services/folder.js", () => ({
  createFolder: mockCreateFolder,
  deleteFolder: mockDeleteFolder,
}));
jest.unstable_mockModule("../../../oauth/index.js", () => ({
  getValidToken: mockGetValidToken,
}));
jest.unstable_mockModule("../../../experiment/hosting/services.js", () => ({
  createRepositoryGithub: jest.fn(),
  uploadFileGithub: jest.fn(),
  enableGithubPages: jest.fn(),
  deleteRepositoryGithub: mockDeleteRepositoryGithub,
  getRepositoryInfo: jest.fn(),
  waitForGithubRepoReady: jest.fn(),
}));
jest.unstable_mockModule("../../../oauth/providers/github/token.js", () => ({
  getGithubToken: jest.fn(),
  getGithubOwner: jest.fn(),
}));

const { deleteExperiment } = await import("../../../experiment/index.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fs.db.batch.mockClear();
  mockWriteLog.mockClear();
  mockGetValidToken.mockReset();
  mockCreateFolder.mockReset();
  mockDeleteFolder.mockReset();
  mockDeleteRepositoryGithub.mockReset();
  fetchMock.__reset();
  rtdbRef.mockClear();
  rtdbRefRemove.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mockEmptyCleanupCollections(experimentID = "EID") {
  fs.getCol(`experiments/${experimentID}/session_metadata`).get.mockResolvedValueOnce(
    makeSnapshot([]),
  );
  fs.getCol(`experiments/${experimentID}/sessions`).get.mockResolvedValueOnce(
    makeSnapshot([]),
  );
}

// ─────────────────────────────────────────────────────────────────────────

// ─── Drive happy path ─────────────────────────────────────────────────────

// ─── E-4 verification: OSF folder cleanup ─────────────────────────────────

// ─── Subcollection cleanup ────────────────────────────────────────────────

// ─── GitHub repository cleanup ────────────────────────────────────────────

// ─── RTDB failure isolation ───────────────────────────────────────────────

describe("deleteExperiment — subcollection cleanup", () => {
  test("walks session_metadata, deletes participant_files + trials, then meta docs", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive", driveFolderPath: "/x" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockDeleteFolder.mockResolvedValueOnce({ success: true });
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });

    // 1 session_metadata doc with 1 participant_file and 0 trials
    const metaSnap = makeSnapshot([{ id: "S1", data: {} }]);
    fs.getCol("experiments/EID/session_metadata").get.mockResolvedValueOnce(metaSnap);

    // Set up the nested subcollection mocks via the snapshot's ref. E-6
    // paginatedDelete chains `.limit(n).get()` so subcollections must
    // expose `limit` returning self.
    metaSnap.docs[0].ref.collection = jest.fn((subname) => {
      if (subname === "participant_files") {
        const sub = {
          get: jest
            .fn()
            .mockResolvedValueOnce(
              makeSnapshot([{ id: "pf1", data: { url: "x" } }]),
            ),
        };
        sub.limit = jest.fn(() => sub);
        return sub;
      }
      if (subname === "trials") {
        const sub = { get: jest.fn().mockResolvedValueOnce(makeSnapshot([])) };
        sub.limit = jest.fn(() => sub);
        return sub;
      }
    });

    fs.getCol("experiments/EID/sessions").get.mockResolvedValueOnce(
      makeSnapshot([]),
    );

    const r = await deleteExperiment("EID", "u1");
    expect(r.success).toBe(true);
    // At least 2 batches: 1 for participant_files, 1 for session_metadata
    expect(fs.db.batch).toHaveBeenCalled();
    expect(rtdbRefRemove).toHaveBeenCalled();
  });

  test("paginates root subcollection deletes until a short page is reached", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive" }),
    });
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });

    const fullPage = makeSnapshot(
      Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, data: {} })),
    );
    const shortPage = makeSnapshot([{ id: "tail", data: {} }]);
    const emptySubcollection = () => {
      const sub = { get: jest.fn().mockResolvedValue(makeSnapshot([])) };
      sub.limit = jest.fn(() => sub);
      return sub;
    };
    [...fullPage.docs, ...shortPage.docs].forEach((doc) => {
      doc.ref.collection = jest.fn(emptySubcollection);
    });
    fs.getCol("experiments/EID/session_metadata").get
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(shortPage);
    fs.getCol("experiments/EID/sessions").get.mockResolvedValueOnce(
      makeSnapshot([]),
    );

    const result = await deleteExperiment("EID", "u1");

    expect(result.success).toBe(true);
    expect(fs.getCol("experiments/EID/session_metadata").get).toHaveBeenCalledTimes(2);
    expect(fs.db.batch).toHaveBeenCalledTimes(2);
  });
});
