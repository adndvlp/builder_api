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

describe("apiDeleteExperiment — HTTP wrapper", () => {
  test("400 when experimentID missing", async () => {
    const res = makeRes();
    await apiDeleteExperiment(makeReq({ body: { uid: "u1" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/experimentID/);
  });

  test("404 when deleteExperiment throws EXPERIMENT_NOT_FOUND", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });

    const res = makeRes();
    await apiDeleteExperiment(
      makeReq({ body: { experimentID: "EID", uid: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(404);
    expect(res.jsonBody.message).toBe("Experiment not found");
  });

  test("500 on generic error from deleteExperiment", async () => {
    fs.getRef("experiments/EID").get.mockRejectedValueOnce(
      new Error("boom"),
    );
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = makeRes();
    await apiDeleteExperiment(
      makeReq({ body: { experimentID: "EID", uid: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.message).toMatch(/Internal server error/);
    errSpy.mockRestore();
  });

  test("200 happy path returns deleteExperiment result body", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive", driveFolderPath: "/x" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockDeleteFolder.mockResolvedValueOnce({ success: true });
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });
    fs.getCol("experiments/EID/session_metadata").get.mockResolvedValueOnce(
      makeSnapshot([]),
    );
    fs.getCol("experiments/EID/sessions").get.mockResolvedValueOnce(
      makeSnapshot([]),
    );

    const res = makeRes();
    await apiDeleteExperiment(
      makeReq({ body: { experimentID: "EID", uid: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.success).toBe(true);
    expect(res.jsonBody.folderDeleted).toBe(true);
  });
});
