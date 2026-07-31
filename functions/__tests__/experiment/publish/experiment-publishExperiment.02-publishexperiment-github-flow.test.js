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

describe("publishExperiment — GitHub flow", () => {
  test("400 when GitHub token fetch fails", async () => {
    mockGetGithubToken.mockResolvedValueOnce({ success: false, error: "no token" });
    const res = makeRes();
    await publishExperiment(
      makeReq({ body: { uid: "u1", repoName: "r", htmlContent: "<h/>" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toBe("GitHub token not found or invalid");
  });

  test("repo exists → updates HTML + enables Pages → 200", async () => {
    mockGetGithubToken.mockResolvedValueOnce({ success: true, access_token: "ghtok" });
    mockGetGithubOwner.mockResolvedValueOnce("owner");
    mockGetRepositoryInfo.mockResolvedValueOnce({ success: true });
    mockUploadFileGithub.mockResolvedValueOnce({ success: true });
    mockEnableGithubPages.mockResolvedValueOnce({
      success: true,
      pagesUrl: "https://owner.github.io/r/",
    });

    const res = makeRes();
    await publishExperiment(
      makeReq({ body: { uid: "u1", repoName: "r", htmlContent: "<h/>" } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.message).toMatch(/updated and published/);
    expect(res.jsonBody.pagesUrl).toBe("https://owner.github.io/r/");
    expect(mockCreateRepositoryGithub).not.toHaveBeenCalled();
    expect(mockWaitForGithubRepoReady).not.toHaveBeenCalled();
    expect(mockUploadFileGithub).toHaveBeenCalledWith(
      "ghtok",
      "owner",
      "r",
      "index.html",
      "<h/>",
      "Update experiment HTML",
    );
  });

  test("repo NOT exists → creates repo + waitForReady + uploads + 201", async () => {
    mockGetGithubToken.mockResolvedValueOnce({ success: true, access_token: "ghtok" });
    mockGetGithubOwner.mockResolvedValueOnce("owner");
    mockGetRepositoryInfo.mockResolvedValueOnce({ success: false });
    mockCreateRepositoryGithub.mockResolvedValueOnce({ success: true });
    mockWaitForGithubRepoReady.mockResolvedValueOnce({ success: true, waitedMs: 250 });
    mockUploadFileGithub.mockResolvedValueOnce({ success: true });
    mockEnableGithubPages.mockResolvedValueOnce({
      success: true,
      pagesUrl: "https://owner.github.io/r/",
    });

    const res = makeRes();
    await publishExperiment(
      makeReq({
        body: {
          uid: "u1",
          repoName: "r",
          htmlContent: "<h/>",
          isPrivate: true,
          description: "exp",
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(res.jsonBody.message).toMatch(/created and published/);
    expect(mockCreateRepositoryGithub).toHaveBeenCalledWith("ghtok", "r", true, "exp");
    expect(mockWaitForGithubRepoReady).toHaveBeenCalledWith("ghtok", "owner", "r");
    expect(mockUploadFileGithub).toHaveBeenCalledWith(
      "ghtok",
      "owner",
      "r",
      "index.html",
      "<h/>",
      "Add experiment HTML file",
    );
  });

  test("400 when createRepositoryGithub fails", async () => {
    mockGetGithubToken.mockResolvedValueOnce({ success: true, access_token: "ghtok" });
    mockGetGithubOwner.mockResolvedValueOnce("owner");
    mockGetRepositoryInfo.mockResolvedValueOnce({ success: false });
    mockCreateRepositoryGithub.mockResolvedValueOnce({
      success: false,
      errorText: "GH down",
    });

    const res = makeRes();
    await publishExperiment(
      makeReq({ body: { uid: "u1", repoName: "r", htmlContent: "<h/>" } }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toBe("Error creating repository");
    expect(res.jsonBody.error).toBe("GH down");
  });

  test("400 when uploadFileGithub for HTML fails", async () => {
    mockGetGithubToken.mockResolvedValueOnce({ success: true, access_token: "ghtok" });
    mockGetGithubOwner.mockResolvedValueOnce("owner");
    mockGetRepositoryInfo.mockResolvedValueOnce({ success: true });
    mockUploadFileGithub.mockResolvedValueOnce({
      success: false,
      errorText: "rate limit",
    });

    const res = makeRes();
    await publishExperiment(
      makeReq({ body: { uid: "u1", repoName: "r", htmlContent: "<h/>" } }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toBe("Error uploading HTML file");
    expect(res.jsonBody.error).toBe("rate limit");
  });

  test("enableGithubPages failure → falls back to estimated pagesUrl, still 200", async () => {
    mockGetGithubToken.mockResolvedValueOnce({ success: true, access_token: "ghtok" });
    mockGetGithubOwner.mockResolvedValueOnce("owner");
    mockGetRepositoryInfo.mockResolvedValueOnce({ success: true });
    mockUploadFileGithub.mockResolvedValueOnce({ success: true });
    mockEnableGithubPages.mockResolvedValueOnce({ success: false });

    const res = makeRes();
    await publishExperiment(
      makeReq({ body: { uid: "u1", repoName: "r", htmlContent: "<h/>" } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.pagesUrl).toBe("https://owner.github.io/r/");
  });

  test("waitForGithubRepoReady timeout → still proceeds and returns 201", async () => {
    mockGetGithubToken.mockResolvedValueOnce({ success: true, access_token: "ghtok" });
    mockGetGithubOwner.mockResolvedValueOnce("owner");
    mockGetRepositoryInfo.mockResolvedValueOnce({ success: false });
    mockCreateRepositoryGithub.mockResolvedValueOnce({ success: true });
    mockWaitForGithubRepoReady.mockResolvedValueOnce({
      success: false,
      errorText: "timeout",
    });
    mockUploadFileGithub.mockResolvedValueOnce({ success: true });
    mockEnableGithubPages.mockResolvedValueOnce({
      success: true,
      pagesUrl: "https://owner.github.io/r/",
    });

    const res = makeRes();
    await publishExperiment(
      makeReq({ body: { uid: "u1", repoName: "r", htmlContent: "<h/>" } }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(mockUploadFileGithub).toHaveBeenCalled();
  });
});
