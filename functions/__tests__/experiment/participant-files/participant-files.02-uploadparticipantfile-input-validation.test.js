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

describe("uploadParticipantFile — input validation", () => {
  test("400 when experimentID missing", async () => {
    const res = makeRes();
    await uploadParticipantFile(makeReq({ body: { files: [] } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toMatch(/experimentID is required/);
  });

  test("400 when files is not an array", async () => {
    const res = makeRes();
    await uploadParticipantFile(
      makeReq({ body: { experimentID: "EID" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toMatch(/files array is required/);
  });

  test("400 when a file entry lacks name/data/type", async () => {
    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          files: [{ name: "a.png" /* missing data + type */ }],
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toMatch(/must have name, data, and type/);
  });

  test("404 when experiment doesn't exist", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          files: [{ name: "a.png", data: "Zm9v", type: "image/png" }],
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(404);
  });

  test("500 when experiment has no owner", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive" }), // no owner
    });
    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          files: [{ name: "a.png", data: "Zm9v", type: "image/png" }],
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.error).toMatch(/no owner/);
  });

  test("400 when token invalid", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageProvider: "googledrive", owner: "u1" }),
    });
    mockGetValidToken.mockResolvedValueOnce({ success: false, error: "bad" });
    const res = makeRes();
    await uploadParticipantFile(
      makeReq({
        body: {
          experimentID: "EID",
          files: [{ name: "a.png", data: "Zm9v", type: "image/png" }],
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toMatch(/googledrive.*token is invalid/);
  });
});

// ─── Drive upload path (+ T-15 verification) ──────────────────────────────
