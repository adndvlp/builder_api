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

describe("uploadParticipantFile — HTTP envelope", () => {
  test("OPTIONS returns 204 and empty body", async () => {
    const res = makeRes();
    await uploadParticipantFile(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
    expect(res.send).toHaveBeenCalledWith("");
  });

  test("non-POST returns 405", async () => {
    const res = makeRes();
    await uploadParticipantFile(makeReq({ method: "GET" }), res);
    expect(res.statusCode).toBe(405);
  });
});

// ─── Validation ────────────────────────────────────────────────────────────
