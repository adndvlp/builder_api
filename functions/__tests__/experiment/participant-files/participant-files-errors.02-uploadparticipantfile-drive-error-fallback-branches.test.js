/**
 * Tier 3 — error/branch coverage for experiment/participant-files.js.
 *
 * Targets the uncovered paths flagged in coverage:
 *   - Unsupported storageProvider in uploadFileToBucket → 500
 *   - Drive: non-ok upload response → 500 with error.message
 *   - Drive: subfolder NOT found → must POST a create call
 *   - Drive: missing webViewLink → built URL fallback
 *   - Dropbox: upload non-ok → 500
 *   - Dropbox: share link already-exists fallback → metadata.url
 *   - Dropbox: share link 4xx without recognized shape → path_lower fallback
 *   - OSF: upload non-ok → 500
 *   - OSF: missing result.data.id → URL built from uploadLink
 *   - OSF: osfComponentId only (no osfUploadLink) → built upload URL
 *   - metadata write rejection is swallowed (upload still 200)
 */
import { jest } from "@jest/globals";
import fetchMock from "../../helpers/fetch-mock.js";
import { makeFsMock, makeReq, makeRes } from "../../helpers/firestore-mock.js";

const fs = makeFsMock();
const mockGetValidToken = jest.fn();

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
}));
jest.unstable_mockModule("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__ts__" },
}));
jest.unstable_mockModule("../../../app.js", () => ({ db: fs.db, app: {} }));
jest.unstable_mockModule("../../../oauth/index.js", () => ({
  getValidToken: mockGetValidToken,
}));

const { uploadParticipantFile } = await import(
  "../../../experiment/participant-files/api/upload.js"
);

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fetchMock.__reset();
  mockGetValidToken.mockReset();
});

function fileBody(overrides = {}) {
  return {
    experimentID: "EID",
    sessionId: "S1",
    files: [{ name: "a.png", data: "Zm9v", type: "image/png" }],
    ...overrides,
  };
}

// ─── Unsupported provider ─────────────────────────────────────────────────

describe("uploadParticipantFile — Drive error/fallback branches", () => {
  test("Drive upload returns non-ok → throws → 500 with drive error message", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "fid",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      // search subfolder → found
      { status: 200, body: { files: [{ id: "sub" }] } },
      // multipart upload → 500
      { status: 500, body: { error: { message: "drive blew up" } } },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.error).toMatch(/drive blew up/);
  });

  test("Drive upload non-ok without error.message → falls back to status-coded message", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "fid",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "sub" }] } },
      { status: 502, body: {} }, // no .error.message
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.error).toMatch(/Drive upload failed \(502\)/);
  });

  test("Drive subfolder NOT found → POSTs create folder before upload (P-4: post-create re-query)", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "fid",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      // 1) search subfolder → empty (none exists yet)
      { status: 200, body: { files: [] } },
      // 2) create subfolder
      { status: 200, body: { id: "newSubId" } },
      // 3) P-4: post-create re-query — single result, no duplicates
      {
        status: 200,
        body: { files: [{ id: "newSubId", createdTime: "2026-01-01" }] },
      },
      // 4) multipart upload OK
      {
        status: 200,
        body: { id: "fileXYZ", webViewLink: "https://drive.example/x" },
      },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.jsonBody.count).toBe(1);

    const calls = fetchMock.__getCalls();
    expect(calls).toHaveLength(4);
    // 2nd call is the create-folder POST
    expect(calls[1].options.method).toBe("POST");
    const createBody = JSON.parse(calls[1].options.body);
    expect(createBody.name).toBe("participant-files");
    expect(createBody.mimeType).toBe("application/vnd.google-apps.folder");
    expect(createBody.parents).toEqual(["fid"]);
  });

  test("P-4 FIX: duplicate folders detected post-create → uses oldest", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "fid",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [] } },
      { status: 200, body: { id: "newId" } },
      // post-create re-query shows TWO folders (race lost)
      {
        status: 200,
        body: {
          files: [
            { id: "oldestId", createdTime: "2026-01-01T00:00:00Z" },
            { id: "newId", createdTime: "2026-01-01T00:00:01Z" },
          ],
        },
      },
      {
        status: 200,
        body: { id: "fileXYZ", webViewLink: "https://drive.example/x" },
      },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.jsonBody.count).toBe(1);
    // Upload should target the OLDEST folder ("oldestId")
    const uploadCall = fetchMock.__getCalls()[3];
    expect(uploadCall.options.body).toContain('"parents":["oldestId"]');
  });

  test("Drive upload missing webViewLink → built URL fallback", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "fid",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "sub" }] } },
      { status: 200, body: { id: "noLinkId" /* no webViewLink */ } },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.jsonBody.fileUrl).toBe(
      "https://drive.google.com/file/d/noLinkId/view",
    );
  });
});

// ─── Dropbox error/fallback branches ──────────────────────────────────────
