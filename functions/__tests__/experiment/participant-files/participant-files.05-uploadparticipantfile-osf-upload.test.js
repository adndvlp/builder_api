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

describe("uploadParticipantFile — OSF upload", () => {
  test("P-3 FIX: OSF happy path looks up/creates participant-files folder, uploads inside it", async () => {
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
      // list files → existing participant-files folder
      {
        status: 200,
        body: {
          data: [
            {
              attributes: { name: "participant-files", kind: "folder" },
              links: {
                upload:
                  "https://files.osf.io/v1/resources/abc/providers/osfstorage/pf-folder-id/",
              },
            },
          ],
        },
      },
      // upload PUT
      { status: 201, body: { data: { id: "osfX" } } },
    ]);

    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          sessionId: "S1",
          files: [{ name: "a.bin", data: "Zm9v", type: "application/octet-stream" }],
        },
      }),
      res,
    );
    expect(res.jsonBody.count).toBe(1);
    expect(res.jsonBody.fileUrl).toMatch(/osf\.io\/osfX/);
    // Upload targeted the folder's upload link, not the root
    const calls = fetchMock.__getCalls();
    expect(calls[1].url).toContain("pf-folder-id");
  });

  test("OSF: throws when uploadLink missing AND osfComponentId missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "osf",
        owner: "u1",
        // no osfUploadLink, no osfComponentId
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });
    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          sessionId: "S1",
          files: [{ name: "a.bin", data: "Zm9v", type: "application/octet-stream" }],
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.error).toMatch(/OSF upload link not configured/);
  });
});
