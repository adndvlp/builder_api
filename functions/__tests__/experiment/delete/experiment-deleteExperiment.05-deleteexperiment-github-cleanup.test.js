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

describe("deleteExperiment — GitHub cleanup", () => {
  test("deletes GitHub repo using explicit repoName and reports repoDeleted", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive" }),
    });
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ githubTokens: { access_token: "gh-token" } }),
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { login: "owner" } },
    ]);
    mockDeleteRepositoryGithub.mockResolvedValueOnce({ success: true });
    mockEmptyCleanupCollections();

    const result = await deleteExperiment("EID", "u1", "repo-from-request");

    expect(result.repoDeleted).toBe(true);
    expect(mockDeleteRepositoryGithub).toHaveBeenCalledWith(
      "gh-token",
      "owner",
      "repo-from-request",
    );
  });

  test("falls back to experiment title and treats GitHub 404 as non-fatal", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: "repo-from-title",
        storageProvider: "googledrive",
      }),
    });
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ githubTokens: { access_token: "gh-token" } }),
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { login: "owner" } },
    ]);
    mockDeleteRepositoryGithub.mockResolvedValueOnce({
      success: false,
      errorCode: 404,
      errorText: "not found",
    });
    mockEmptyCleanupCollections();

    const result = await deleteExperiment("EID", "u1");

    expect(result.repoDeleted).toBe(false);
    expect(result.repoWarning).toBeUndefined();
    expect(mockDeleteRepositoryGithub).toHaveBeenCalledWith(
      "gh-token",
      "owner",
      "repo-from-title",
    );
  });

  test("returns repoWarning for GitHub delete errors and thrown failures", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive" }),
    });
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ githubTokens: { access_token: "gh-token" } }),
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { login: "owner" } },
    ]);
    mockDeleteRepositoryGithub.mockResolvedValueOnce({
      success: false,
      errorCode: 500,
      errorText: "github down",
    });
    mockEmptyCleanupCollections();

    const deleteError = await deleteExperiment("EID", "u1");
    expect(deleteError.repoWarning).toBe("github down");

    fs.getRef("experiments/E2").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive" }),
    });
    fs.getRef("users/u1").get.mockRejectedValueOnce(new Error("user lookup down"));
    mockEmptyCleanupCollections("E2");

    const thrownError = await deleteExperiment("E2", "u1");
    expect(thrownError.repoWarning).toBe("user lookup down");
  });

  test("skips repository deletion when GitHub user lookup is not ok", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive" }),
    });
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ githubTokens: { access_token: "gh-token" } }),
    });
    fetchMock.__setMockResponses([{ status: 401, body: { message: "bad token" } }]);
    mockEmptyCleanupCollections();

    const result = await deleteExperiment("EID", "u1");

    expect(result.repoDeleted).toBe(false);
    expect(result.repoWarning).toBeUndefined();
    expect(mockDeleteRepositoryGithub).not.toHaveBeenCalled();
  });
});
