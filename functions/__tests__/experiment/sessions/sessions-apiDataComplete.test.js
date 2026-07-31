/**
 * Tests for sessions/index.js::apiDataComplete — the DEFAULT hot path.
 * (IndexedDB=true + batchSize=0 → client sends entire trial array at the end.)
 */
import { jest } from "@jest/globals";
import { makeFsMock, makeReq, makeRes } from "../../helpers/firestore-mock.js";

const fs = makeFsMock();
const mockWriteLog = jest.fn().mockResolvedValue(true);
const mockGetValidToken = jest.fn();
const mockAppendResult = jest.fn();
const mockGetDatabase = jest.fn(() => ({
  ref: jest.fn(() => ({
    once: jest.fn().mockResolvedValue({ val: () => null }),
    update: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
}));
jest.unstable_mockModule("firebase-functions/v2/database", () => ({
  onValueWritten: (_opts, handler) => handler,
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
jest.unstable_mockModule("../../../oauth/index.js", () => ({
  getValidToken: mockGetValidToken,
}));
jest.unstable_mockModule("../../../experiment/sessions/storage.js", () => ({
  appendResult: mockAppendResult,
  createSession: jest.fn(),
  postFile: jest.fn(),
  escapeDriveQueryValue: (v) => String(v ?? ""),
}));
jest.unstable_mockModule("../../../experiment/sessions/handler.js", () => ({
  handleCreateSession: jest.fn(),
  handleAppendResult: jest.fn(),
  handleListSessions: jest.fn(),
  handleDownloadSession: jest.fn(),
  handleDeleteSession: jest.fn(),
}));

const { apiDataComplete } = await import("../../../experiment/sessions/index.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.db.collection.mockClear();
  mockWriteLog.mockClear();
  mockGetValidToken.mockReset();
  mockAppendResult.mockReset();
});

describe("apiDataComplete — validation", () => {
  test("400 when experimentID missing", async () => {
    const res = makeRes();
    await apiDataComplete(makeReq({ body: { sessionId: "S1", trialsData: [{}] } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Missing required parameters/);
  });

  test("400 when sessionId missing", async () => {
    const res = makeRes();
    await apiDataComplete(makeReq({ body: { experimentID: "E", trialsData: [{}] } }), res);
    expect(res.statusCode).toBe(400);
  });

  test("400 when trialsData missing", async () => {
    const res = makeRes();
    await apiDataComplete(makeReq({ body: { experimentID: "E", sessionId: "S1" } }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe("apiDataComplete — experiment checks", () => {
  test("400 EXPERIMENT_NOT_FOUND when doc missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await apiDataComplete(
      makeReq({ body: { experimentID: "EID", sessionId: "S1", trialsData: [{ a: 1 }] } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("EXPERIMENT_NOT_FOUND");
  });

  test("400 DATA_COLLECTION_NOT_ACTIVE when active=false", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: false }),
    });
    const res = makeRes();
    await apiDataComplete(
      makeReq({ body: { experimentID: "EID", sessionId: "S1", trialsData: [{ a: 1 }] } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("DATA_COLLECTION_NOT_ACTIVE");
  });
});

describe("apiDataComplete — happy path per provider", () => {
  test("googledrive: converts trials to CSV, calls appendResult, writes session_metadata", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        owner: "u1",
        storageProvider: "googledrive",
        driveFolderId: "fld1",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockAppendResult.mockResolvedValueOnce({
      success: true,
      id: "fileX",
    });

    const trials = [
      { trial_index: 0, response: "a" },
      { trial_index: 1, response: "b" },
    ];
    const res = makeRes();
    await apiDataComplete(
      makeReq({ body: { experimentID: "EID", sessionId: "S1", trialsData: trials } }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(res.jsonBody.success).toBe(true);
    expect(res.jsonBody.storageProvider).toBe("googledrive");

    // appendResult called with provider, token, folderId, expID, sessionId, CSV
    expect(mockAppendResult).toHaveBeenCalledTimes(1);
    const [provider, token, folderId, expID, sid, csv] = mockAppendResult.mock.calls[0];
    expect(provider).toBe("googledrive");
    expect(token).toBe("tok");
    expect(folderId).toBe("fld1");
    expect(expID).toBe("EID");
    expect(sid).toBe("S1");
    expect(csv).toMatch(/"trial_index","response"/);
    expect(csv).toContain('0,"a"');
    expect(csv).toContain('1,"b"');

    // session_metadata written with fileUrl
    const metaRef = fs.getRef("experiments/EID/session_metadata/S1");
    expect(metaRef.set).toHaveBeenCalled();
    const metaArg = metaRef.set.mock.calls[0][0];
    expect(metaArg.storageProvider).toBe("googledrive");
    expect(metaArg.fileUrl).toContain("drive.google.com");
    expect(metaArg.fileUrl).toContain("fileX");
  });

  test("osf: folderIdentifier prefers osfUploadLink", async () => {
    const uploadLink =
      "https://files.osf.io/v1/resources/abc/providers/osfstorage/";
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        owner: "u1",
        storageProvider: "osf",
        osfUploadLink: uploadLink,
        osfComponentId: "abc",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockAppendResult.mockResolvedValueOnce({
      success: true,
      id: "osfFile",
      fileUrl: "https://osf.io/dl",
    });

    const res = makeRes();
    await apiDataComplete(
      makeReq({ body: { experimentID: "EID", sessionId: "S1", trialsData: [{ x: 1 }] } }),
      res,
    );

    expect(res.statusCode).toBe(201);
    const folderArg = mockAppendResult.mock.calls[0][2];
    expect(folderArg).toBe(uploadLink); // appendResult treats this as uploadLink

    const metaRef = fs.getRef("experiments/EID/session_metadata/S1");
    expect(metaRef.set.mock.calls[0][0].fileUrl).toBe("https://osf.io/dl");
  });

  test("osf: falls back to building uploadLink from osfComponentId when osfUploadLink missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        owner: "u1",
        storageProvider: "osf",
        osfComponentId: "comp42",
        // osfUploadLink missing
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockAppendResult.mockResolvedValueOnce({ success: true });

    const res = makeRes();
    await apiDataComplete(
      makeReq({ body: { experimentID: "EID", sessionId: "S1", trialsData: [{ x: 1 }] } }),
      res,
    );

    const folderArg = mockAppendResult.mock.calls[0][2];
    expect(folderArg).toBe(
      "https://files.osf.io/v1/resources/comp42/providers/osfstorage/",
    );
  });

  test("400 with provider-specific token error when getValidToken fails", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ active: true, owner: "u1", storageProvider: "dropbox" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: false, error: "x" });
    const res = makeRes();
    await apiDataComplete(
      makeReq({ body: { experimentID: "EID", sessionId: "S1", trialsData: [{}] } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("INVALID_DROPBOX_TOKEN");
  });

  test("400 when appendResult returns failure", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        owner: "u1",
        storageProvider: "dropbox",
        dropboxFolder: "/exp",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockAppendResult.mockResolvedValueOnce({
      success: false,
      errorText: "remote down",
    });
    const res = makeRes();
    await apiDataComplete(
      makeReq({ body: { experimentID: "EID", sessionId: "S1", trialsData: [{}] } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Failed to send data to dropbox/);
    expect(res.jsonBody.error).toBe("remote down");
  });
});

describe("apiDataComplete — input normalization", () => {
  test("accepts single trial object (not array) by wrapping it", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        active: true,
        owner: "u1",
        storageProvider: "googledrive",
        driveFolderId: "fld",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: true, access_token: "tok" });
    mockAppendResult.mockResolvedValueOnce({ success: true, id: "f1" });

    const res = makeRes();
    await apiDataComplete(
      makeReq({
        body: {
          experimentID: "EID",
          sessionId: "S1",
          trialsData: { only: "one" }, // not an array
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    const csv = mockAppendResult.mock.calls[0][5];
    expect(csv).toContain('"only"');
    expect(csv).toContain('"one"');
  });
});
