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

describe("uploadParticipantFile — Dropbox error/fallback branches", () => {
  test("upload non-ok → 500 with error_summary", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "dropbox",
        owner: "u1",
        dropboxFolder: "/x",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 500, body: { error_summary: "dbx fire" } },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.error).toMatch(/dbx fire/);
  });

  test("upload non-ok no error_summary → status-coded fallback", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "dropbox",
        owner: "u1",
        dropboxFolder: "/x",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([{ status: 503, body: {} }]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.error).toMatch(/Dropbox upload failed \(503\)/);
  });

  test("default '/' folder when dropboxFolder missing on exp doc", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "dropbox", owner: "u1" }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { id: "u1", path_lower: "/participant-files/a" } },
      { status: 200, body: { url: "https://dbx.share/a" } },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.jsonBody.count).toBe(1);
    const uploadCall = fetchMock.__getCalls()[0];
    const apiArg = JSON.parse(uploadCall.options.headers["Dropbox-API-Arg"]);
    expect(apiArg.path).toMatch(/^\/\/participant-files\//);
  });

  test("share link already exists → returns metadata.url", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "dropbox",
        owner: "u1",
        dropboxFolder: "/x",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: { id: "u1", path_lower: "/x/participant-files/y" },
      },
      {
        status: 409,
        body: {
          shared_link_already_exists: {
            metadata: { url: "https://dbx.share/existing" },
          },
        },
      },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.jsonBody.fileUrl).toBe("https://dbx.share/existing");
  });

  test("share link 4xx unrecognized shape → falls back to result.path_lower", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "dropbox",
        owner: "u1",
        dropboxFolder: "/x",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { id: "u1", path_lower: "/x/y" } },
      { status: 400, body: {} },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.jsonBody.fileUrl).toBe("/x/y");
  });
});

// ─── OSF error/fallback branches ─────────────────────────────────────────
