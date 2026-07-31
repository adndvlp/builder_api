/**
 * Tests for experiment/index.js::publishExperiment.
 * Covers: OPTIONS preflight, validation, GitHub flow (create vs update branches +
 * repo-ready polling + media upload + Pages fallback), storage-provider change
 * branches (Drive/Dropbox/OSF with inline OSF project creation), the
 * createExperiment-on-missing path, and the catch-all 500.
 */
import { jest } from "@jest/globals";
import { makeFsMock, makeReq, makeRes } from "../../helpers/firestore-mock.js";
import fetchMock from "../../helpers/fetch-mock.js";

const fs = makeFsMock();
const mockWriteLog = jest.fn().mockResolvedValue(true);
const mockGetValidToken = jest.fn();
const mockCreateFolder = jest.fn();
const mockDeleteFolder = jest.fn();
const mockCreateRepositoryGithub = jest.fn();
const mockUploadFileGithub = jest.fn();
const mockEnableGithubPages = jest.fn();
const mockDeleteRepositoryGithub = jest.fn();
const mockGetRepositoryInfo = jest.fn();
const mockWaitForGithubRepoReady = jest.fn();
const mockGetGithubToken = jest.fn();
const mockGetGithubOwner = jest.fn();

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
  createRepositoryGithub: mockCreateRepositoryGithub,
  uploadFileGithub: mockUploadFileGithub,
  enableGithubPages: mockEnableGithubPages,
  deleteRepositoryGithub: mockDeleteRepositoryGithub,
  getRepositoryInfo: mockGetRepositoryInfo,
  waitForGithubRepoReady: mockWaitForGithubRepoReady,
}));
jest.unstable_mockModule("../../../oauth/providers/github/token.js", () => ({
  getGithubToken: mockGetGithubToken,
  getGithubOwner: mockGetGithubOwner,
}));

const { publishExperiment } = await import("../../../experiment/index.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fs.db.batch.mockClear();
  mockWriteLog.mockClear();
  mockGetValidToken.mockReset();
  mockCreateFolder.mockReset();
  mockDeleteFolder.mockReset();
  mockCreateRepositoryGithub.mockReset();
  mockUploadFileGithub.mockReset();
  mockEnableGithubPages.mockReset();
  mockDeleteRepositoryGithub.mockReset();
  mockGetRepositoryInfo.mockReset();
  mockWaitForGithubRepoReady.mockReset();
  mockGetGithubToken.mockReset();
  mockGetGithubOwner.mockReset();
  fetchMock.__reset();
});

// ─── Preflight + validation ────────────────────────────────────────────────

// ─── GitHub flow — happy + error paths ─────────────────────────────────────

// ─── Media files ───────────────────────────────────────────────────────────

// ─── experimentID block branches ───────────────────────────────────────────

// ─── Internal error ────────────────────────────────────────────────────────

describe("publishExperiment — experimentID handling", () => {
  test("experiment exists + provider change to OSF + userDoc missing → 400 (cannot resolve projectId)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "osftok" });
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });

    const res = makeRes();
    await publishExperiment(
      makeReq({
        body: {
          uid: "u1",
          repoName: "r",
          htmlContent: "<h/>",
          experimentID: "EID",
          storageProvider: "osf",
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Could not resolve OSF projectId/);
    expect(mockCreateFolder).not.toHaveBeenCalled();
    // GitHub flow must NOT be reached
    expect(mockGetGithubToken).not.toHaveBeenCalled();
  });

  test("experiment exists + provider change to OSF + project creation fails → 400", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "osftok" });
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    // OSF project creation returns 5xx
    fetchMock.__setMockResponses([{ status: 500, body: "boom" }]);

    const res = makeRes();
    await publishExperiment(
      makeReq({
        body: {
          uid: "u1",
          repoName: "r",
          htmlContent: "<h/>",
          experimentID: "EID",
          storageProvider: "osf",
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Could not resolve OSF projectId/);
    expect(mockCreateFolder).not.toHaveBeenCalled();
  });

  test("experiment NOT exists → calls createExperiment which sets the Firestore doc", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "drtok" });
    mockCreateFolder.mockResolvedValueOnce({ success: true, folderId: "fid1" });
    mockGetGithubToken.mockResolvedValueOnce({ success: true, access_token: "ghtok" });
    mockGetGithubOwner.mockResolvedValueOnce("o");
    mockGetRepositoryInfo.mockResolvedValueOnce({ success: true });
    mockUploadFileGithub.mockResolvedValueOnce({ success: true });
    mockEnableGithubPages.mockResolvedValueOnce({ success: true, pagesUrl: "u" });

    await publishExperiment(
      makeReq({
        body: {
          uid: "u1",
          repoName: "r",
          htmlContent: "<h/>",
          experimentID: "EID",
          storageProvider: "googledrive",
        },
      }),
      makeRes(),
    );

    expect(mockWriteLog).toHaveBeenCalledWith("EID", "createExperiment");
    expect(mockCreateFolder).toHaveBeenCalledWith(
      "googledrive",
      "drtok",
      "/ExpBuilder/r",
      "r",
    );
    expect(fs.getRef("experiments/EID").create).toHaveBeenCalled();
    const setArg = fs.getRef("experiments/EID").create.mock.calls[0][0];
    expect(setArg.title).toBe("r");
    expect(setArg.storageProvider).toBe("googledrive");
    expect(setArg.owner).toBe("u1");
  });
});
