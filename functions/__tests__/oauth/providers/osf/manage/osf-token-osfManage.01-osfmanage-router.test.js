/**
 * Tests for oauth/osf-token.js::osfManage — the unified router for 5 actions:
 * saveToken, validateToken, disconnect, createComponent, uploadFile.
 *
 * Covers happy paths, missing-param branches, invalid-token branches, and the
 * router's catch-all (invalid action + thrown error). Uses node-fetch mock for
 * the OSF API calls.
 */
import { jest } from "@jest/globals";
import fetchMock from "../../../../helpers/fetch-mock.js";
import { makeFsMock, makeReq, makeRes } from "../../../../helpers/firestore-mock.js";

const fs = makeFsMock();

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
}));
jest.unstable_mockModule("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: jest.fn().mockResolvedValue({ uid: "u1" }) }),
}));
jest.unstable_mockModule("../../../../../utils/auth.js", () => ({
  requireAuth: jest.fn().mockResolvedValue("u1"),
  verifyFirebaseAuth: jest.fn().mockResolvedValue({ ok: true, uid: "u1" }),
}));
jest.unstable_mockModule("../../../../../app.js", () => ({ db: fs.db, app: {} }));

const { osfManage } = await import("../../../../../oauth/api/osf-manage.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fetchMock.__reset();
});

// ─── Router ────────────────────────────────────────────────────────────────

describe("osfManage — router", () => {
  test("OPTIONS preflight returns 204", async () => {
    const res = makeRes();
    await osfManage(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
  });

  test("invalid action → 400 with supported list", async () => {
    const res = makeRes();
    await osfManage(makeReq({ body: { action: "bogus" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Supported: saveToken/);
  });

  test("internal error → 500", async () => {
    // saveToken triggers validateOSFToken via fetch. Make fs.set throw to bubble
    // an unexpected error through the outer catch.
    fetchMock.__setMockResponses([
      // validateOSFToken: ok
      { status: 200, body: { data: { id: "uid", attributes: { full_name: "x" } } } },
      // project validation: ok with write permission (O-3)
      {
        status: 200,
        body: {
          data: { attributes: { current_user_permissions: ["read", "write"] } },
        },
      },
    ]);
    fs.getRef("users/u1").set.mockRejectedValueOnce(new Error("db down"));

    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "saveToken", uid: "u1", token: "T", projectId: "P" },
      }),
      res,
    );
    expect(res.statusCode).toBe(500);
    // T-11: response is generic; internal "db down" is logged but not leaked.
    expect(res.jsonBody.message).toBe("Internal server error");
    expect(res.jsonBody.error).toBeUndefined();
  });
});

// ─── saveToken ─────────────────────────────────────────────────────────────
