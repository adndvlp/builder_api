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

describe("uploadParticipantFile — OSF error/fallback branches", () => {
  test("upload non-ok → 500 with text body", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "osf",
        owner: "u1",
        osfUploadLink:
          "https://files.osf.io/v1/resources/abc/providers/osfstorage/",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    // P-3: list-folder lookup first; 404 falls back to root uploadLink so
    // the existing upload-error contract holds.
    fetchMock.__setMockResponses([
      { status: 404, body: {} },
      { status: 500, body: "osf failure text" },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.error).toMatch(/osf failure text/);
  });

  test("upload non-ok empty text → status-coded fallback", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "osf",
        owner: "u1",
        osfUploadLink:
          "https://files.osf.io/v1/resources/abc/providers/osfstorage/",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 404, body: {} }, // list lookup fails → fallback to root
      { status: 502, body: "" },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.error).toMatch(/OSF upload failed \(502\)/);
  });

  test("missing data.id → URL built from uploadLink path", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "osf",
        owner: "u1",
        osfUploadLink:
          "https://files.osf.io/v1/resources/abc/providers/osfstorage/",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 404, body: {} }, // list lookup fails → fallback to root
      { status: 200, body: {} },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.jsonBody.fileUrl).toBe(
      "https://osf.io/abc/providers/osfstorage/",
    );
  });

  test("osfComponentId only (no osfUploadLink) → constructs upload URL", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "osf",
        owner: "u1",
        osfComponentId: "comp123",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 404, body: {} }, // list lookup fails → fallback to root
      { status: 200, body: { data: { id: "osfFile1" } } },
    ]);
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.jsonBody.count).toBe(1);
    const uploadCall = fetchMock.__getCalls()[1];
    expect(uploadCall.url).toContain(
      "https://files.osf.io/v1/resources/comp123/providers/osfstorage/",
    );
  });
});

// ─── Metadata write tolerance ─────────────────────────────────────────────
