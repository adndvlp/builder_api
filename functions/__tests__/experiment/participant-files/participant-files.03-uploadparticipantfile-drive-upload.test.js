/**
 * Tests for experiment/participant-files.js::uploadParticipantFile.
 * Covers HTTP shape, validation, per-provider upload paths,
 * and T-15 escape applied in Drive subfolder lookup.
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

// ─── HTTP envelope ─────────────────────────────────────────────────────────

describe("uploadParticipantFile — Drive upload", () => {
  test("happy path: ensures subfolder via search (no create), uploads file, writes metadata", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        driveFolderId: "expFolder",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });

    fetchMock.__setMockResponses([
      // search "participant-files" subfolder → found
      { status: 200, body: { files: [{ id: "subFolderId" }] } },
      // multipart upload
      {
        status: 200,
        body: {
          id: "fileXYZ",
          webViewLink: "https://drive.google.com/file/d/fileXYZ/view",
        },
      },
    ]);

    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          sessionId: "S1",
          files: [
            {
              name: "screenshot.png",
              data: "data:image/png;base64,Zm9v",
              type: "image/png",
              size: 3,
            },
          ],
        },
      }),
      res,
    );

    expect(res.jsonBody.count).toBe(1);
    expect(res.jsonBody.fileUrl).toContain("fileXYZ");

    // Metadata written to participant_files subcollection
    const metaRef = fs.getRef("experiments/EID/session_metadata/S1");
    // The subcollection ref is created via getCol after path
    // The doc has an auto-generated ID — test just verifies set() happened
    const filesCol = fs.getCol("experiments/EID/session_metadata/S1/participant_files");
    // doc() invoked at least once (auto ID)
    expect(filesCol.doc).toHaveBeenCalled();
  });

  test("T-15 FIX: Drive subfolder search query has folderName + parentId escaped", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "googledrive",
        owner: "u1",
        // parent id with a single quote — would break query if unescaped
        driveFolderId: "fld'EVIL",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "sub" }] } },
      { status: 200, body: { id: "uploadedFile" } },
    ]);

    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          sessionId: "S1",
          files: [{ name: "x.bin", data: "Zm9v", type: "application/octet-stream" }],
        },
      }),
      res,
    );

    expect(res.jsonBody.count).toBe(1);
    const searchCall = fetchMock.__getCalls()[0];
    const decoded = decodeURIComponent(searchCall.url);
    // The apostrophe in parentId must appear escaped (\\') NOT raw
    expect(decoded).toContain("'fld\\'EVIL' in parents");
    expect(decoded).not.toContain("'fld'EVIL' in parents");
  });
});

// ─── Dropbox upload path ──────────────────────────────────────────────────
