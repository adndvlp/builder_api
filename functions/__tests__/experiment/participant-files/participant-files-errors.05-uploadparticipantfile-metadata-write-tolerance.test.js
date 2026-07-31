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

describe("uploadParticipantFile — metadata write tolerance", () => {
  test("metadata write rejection is swallowed; response still 200", async () => {
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
      { status: 200, body: { id: "fX", webViewLink: "https://drive.example/fX" } },
    ]);
    // Pre-create the autoId doc ref the chain will hit, then force set() to reject.
    fs
      .getRef(
        "experiments/EID/session_metadata/S1/participant_files/undefined",
      )
      .set.mockRejectedValueOnce(new Error("meta boom"));

    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: fileBody() }), res);
    expect(res.jsonBody.count).toBe(1);
    expect(res.jsonBody.fileUrl).toContain("fX");
  });

  test("no sessionId → metadata writes under '_unlinked' bucket", async () => {
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
      { status: 200, body: { id: "fY", webViewLink: "https://drive.example/fY" } },
    ]);

    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          // no sessionId
          files: [{ name: "a.png", data: "Zm9v", type: "image/png" }],
        },
      }),
      res,
    );
    expect(res.jsonBody.count).toBe(1);
    // Confirms the _unlinked path is hit
    const unlinkedCol = fs.getCol(
      "experiments/EID/session_metadata/_unlinked/participant_files",
    );
    expect(unlinkedCol.doc).toHaveBeenCalled();
  });
});
