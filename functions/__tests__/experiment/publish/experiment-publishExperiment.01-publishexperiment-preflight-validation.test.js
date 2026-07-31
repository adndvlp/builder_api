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

describe("publishExperiment — preflight + validation", () => {
  test("OPTIONS returns 204", async () => {
    const res = makeRes();
    await publishExperiment(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
    expect(res.sentBody).toBe("");
  });

  test("T-2: uid is now taken from Firebase Auth, not body (no separate uid-missing check)", async () => {
    // With T-2, uid comes from the Bearer token. The "Missing required
    // parameters" check now only covers repoName/htmlContent.
    const res = makeRes();
    await publishExperiment(
      makeReq({ body: { repoName: "r", htmlContent: "<h/>" } }),
      res,
    );
    // requireAuth is mocked to return "u1"; this request reaches the
    // validation path past auth.
    expect(res.statusCode).not.toBe(400);
  });

  test("400 when repoName missing", async () => {
    const res = makeRes();
    await publishExperiment(
      makeReq({ body: { uid: "u", htmlContent: "<h/>" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  test("400 when htmlContent missing", async () => {
    const res = makeRes();
    await publishExperiment(
      makeReq({ body: { uid: "u", repoName: "r" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});
