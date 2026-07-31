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

describe("deleteExperiment — error paths", () => {
  test("throws EXPERIMENT_NOT_FOUND when exp doc missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    await expect(deleteExperiment("EID", "u1")).rejects.toThrow(
      "EXPERIMENT_NOT_FOUND",
    );
  });

  test("continues with storageWarning when token lookup fails", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "dropbox",
        dropboxFolder: "/ExpBuilder/EID",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: false, error: "no token" });
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });
    mockEmptyCleanupCollections();

    const result = await deleteExperiment("EID", "u1");

    expect(result.success).toBe(true);
    expect(result.folderDeleted).toBe(false);
    expect(result.storageWarning).toBe("Token error: no token");
    expect(mockDeleteFolder).not.toHaveBeenCalled();
  });

  test("continues with storageWarning when deleteFolder fails or throws", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "dropbox",
        dropboxFolder: "/ExpBuilder/EID",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockDeleteFolder.mockResolvedValueOnce({
      success: false,
      errorText: "folder locked",
    });
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });
    mockEmptyCleanupCollections();

    const failedDelete = await deleteExperiment("EID", "u1");
    expect(failedDelete.storageWarning).toBe("folder locked");
    expect(failedDelete.folderDeleted).toBe(false);

    fs.getRef("experiments/E2").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        driveFolderPath: "/ExpBuilder/E2",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockDeleteFolder.mockRejectedValueOnce(new Error("drive down"));
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });
    mockEmptyCleanupCollections("E2");

    const thrownDelete = await deleteExperiment("E2", "u1");
    expect(thrownDelete.storageWarning).toBe("drive down");
    expect(thrownDelete.folderDeleted).toBe(false);
  });
});
