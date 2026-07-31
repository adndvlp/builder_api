/**
 * Tests for experiment/index.js::createExperiment + apiDeleteExperiment HTTP wrapper.
 *
 * createExperiment: per-provider provider-fields wiring, OSF projectId resolution,
 * token failure path, folder error path, anonymous (no-uid) skip-folder branch.
 *
 * apiDeleteExperiment: 400 missing param, 404 EXPERIMENT_NOT_FOUND mapping,
 * 500 generic, 200 happy path.
 */
import { jest } from "@jest/globals";
import { makeFsMock, makeReq, makeRes, makeSnapshot } from "../../helpers/firestore-mock.js";

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

const { createExperiment, apiDeleteExperiment } = await import(
  "../../../experiment/index.js"
);

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
  rtdbRef.mockClear();
  rtdbRefRemove.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────
// createExperiment
// ─────────────────────────────────────────────────────────────────────────

describe("createExperiment — OSF", () => {
  test("uses user.osfProjectId as projectPath, persists osfComponentId + osfUploadLink", async () => {
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfProjectId: "proj7" }),
    });
    mockCreateFolder.mockResolvedValueOnce({
      success: true,
      componentId: "comp9",
      uploadLink: "https://files.osf.io/v1/resources/comp9/providers/osfstorage/",
    });

    const r = await createExperiment("EID", "My Exp", "u1", "osf");

    expect(r.success).toBe(true);
    expect(r.folderId).toBe("comp9");
    expect(mockCreateFolder).toHaveBeenCalledWith(
      "osf",
      "tok",
      "proj7", // projectId, not folderPath
      "My Exp",
    );

    const body = fs.getRef("experiments/EID").create.mock.calls[0][0];
    expect(body.osfComponentId).toBe("comp9");
    expect(body.osfUploadLink).toBe(
      "https://files.osf.io/v1/resources/comp9/providers/osfstorage/",
    );
    expect(body).not.toHaveProperty("driveFolderId");
    expect(body).not.toHaveProperty("dropboxFolder");
  });

  test("OSF without osfProjectId in user doc falls back to folderPath", async () => {
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    mockCreateFolder.mockResolvedValueOnce({
      success: true,
      componentId: "comp9",
      uploadLink: "u",
    });

    await createExperiment("EID", "My Exp", "u1", "osf");

    expect(mockCreateFolder).toHaveBeenCalledWith(
      "osf",
      "tok",
      "/ExpBuilder/My Exp", // fallback
      "My Exp",
    );
  });

  // ─── BUG FIX (E-?: createExperiment defensive userDoc.exists) ───────────
  test("OSF with missing user doc falls back to folderPath (no TypeError)", async () => {
    // Repro: previously `userData = userDoc.data()` returned undefined when
    // doc didn't exist; `userData.osfProjectId` then threw TypeError that
    // was swallowed by the outer catch — surfaced as cryptic storageError
    // and the experiment was created with storageProvider=osf but no
    // componentId. `publishExperiment` already guarded with userDoc.exists;
    // createExperiment now matches.
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });
    mockCreateFolder.mockResolvedValueOnce({
      success: true,
      componentId: "comp9",
      uploadLink: "u",
    });

    const r = await createExperiment("EID", "My Exp", "u1", "osf");

    expect(r.success).toBe(true);
    expect(r.folderCreated).toBe(true);
    expect(r).not.toHaveProperty("storageError");
    expect(mockCreateFolder).toHaveBeenCalledWith(
      "osf",
      "tok",
      "/ExpBuilder/My Exp", // fell back cleanly
      "My Exp",
    );
  });
});
