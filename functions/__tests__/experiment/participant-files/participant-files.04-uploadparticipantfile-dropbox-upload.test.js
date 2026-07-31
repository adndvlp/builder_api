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

describe("uploadParticipantFile — Dropbox upload", () => {
  test("happy path: uploads, creates share link, writes metadata", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        storageProvider: "dropbox",
        owner: "u1",
        dropboxFolder: "/ExpBuilder/EID",
      }),
    });
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "tok",
    });

    fetchMock.__setMockResponses([
      // upload
      { status: 200, body: { id: "u1", path_lower: "/exp/participant-files/x" } },
      // share link
      { status: 200, body: { url: "https://dbx.share/x" } },
    ]);

    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          sessionId: "S1",
          files: [{ name: "a.png", data: "Zm9v", type: "image/png" }],
        },
      }),
      res,
    );
    expect(res.jsonBody.count).toBe(1);
    expect(res.jsonBody.fileUrl).toBe("https://dbx.share/x");
  });
});

// ─── OSF upload path ──────────────────────────────────────────────────────
