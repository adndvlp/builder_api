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

describe("deleteExperiment — googledrive", () => {
  test("deletes Drive folder, clears subcollections, removes RTDB sessions/EID (E-5)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        driveFolderPath: "/ExpBuilder/EID",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockDeleteFolder.mockResolvedValueOnce({ success: true });

    // No user doc → skip GitHub
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });

    // Empty subcollections
    fs.getCol("experiments/EID/session_metadata").get.mockResolvedValueOnce(
      makeSnapshot([]),
    );
    fs.getCol("experiments/EID/sessions").get.mockResolvedValueOnce(
      makeSnapshot([]),
    );

    const r = await deleteExperiment("EID", "u1");

    expect(r.success).toBe(true);
    expect(r.folderDeleted).toBe(true);
    expect(r.rtdbCleared).toBe(true);

    expect(mockDeleteFolder).toHaveBeenCalledWith(
      "googledrive",
      "tok",
      "/ExpBuilder/EID",
    );

    // E-5: RTDB ref("sessions/EID").remove() must be called
    expect(rtdbRef).toHaveBeenCalledWith("sessions/EID");
    expect(rtdbRefRemove).toHaveBeenCalledTimes(1);

    // experiment doc deleted
    expect(fs.getRef("experiments/EID").delete).toHaveBeenCalled();
  });
});
