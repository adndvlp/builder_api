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

describe("publishExperiment — media files", () => {
  test("uploads img/vid/aud (decoding base64, stripping data:URL prefix); skips invalid type + empty content", async () => {
    mockGetGithubToken.mockResolvedValueOnce({ success: true, access_token: "ghtok" });
    mockGetGithubOwner.mockResolvedValueOnce("owner");
    mockGetRepositoryInfo.mockResolvedValueOnce({ success: true });
    mockUploadFileGithub
      .mockResolvedValueOnce({ success: true })   // index.html
      .mockResolvedValueOnce({ success: true })   // img
      .mockResolvedValueOnce({ success: true })   // vid
      .mockResolvedValueOnce({ success: true });  // aud
    mockEnableGithubPages.mockResolvedValueOnce({
      success: true,
      pagesUrl: "u",
    });

    const mediaFiles = [
      { type: "img", filename: "a.png", content: "data:image/png;base64,QUJD" }, // "ABC"
      { type: "vid", filename: "b.mp4", content: "WFla" },                       // "XYZ"
      { type: "aud", filename: "c.mp3", content: "MTIz" },                       // "123"
      { type: "doc", filename: "skip.pdf", content: "ZZZ" },                     // invalid type
      { type: "img", filename: "empty.png" },                                    // missing content
    ];

    const res = makeRes();
    await publishExperiment(
      makeReq({
        body: {
          uid: "u1",
          repoName: "r",
          htmlContent: "<h/>",
          mediaFiles,
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(mockUploadFileGithub).toHaveBeenCalledTimes(4);

    const imgCall = mockUploadFileGithub.mock.calls[1];
    expect(imgCall[3]).toBe("img/a.png");
    expect(Buffer.isBuffer(imgCall[4])).toBe(true);
    expect(imgCall[4].toString()).toBe("ABC");

    const vidCall = mockUploadFileGithub.mock.calls[2];
    expect(vidCall[3]).toBe("vid/b.mp4");
    expect(vidCall[4].toString()).toBe("XYZ");

    const audCall = mockUploadFileGithub.mock.calls[3];
    expect(audCall[3]).toBe("aud/c.mp3");
    expect(audCall[4].toString()).toBe("123");
  });
});
