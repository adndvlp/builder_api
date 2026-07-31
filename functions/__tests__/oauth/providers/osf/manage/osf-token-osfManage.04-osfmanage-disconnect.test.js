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

describe("osfManage — disconnect", () => {
  test("400 when uid missing", async () => {
    const res = makeRes();
    await osfManage(makeReq({ body: { action: "disconnect" } }), res);
    expect(res.statusCode).toBe(400);
  });

  test("clears osfToken/osfTokens + related fields (O-2 fix verification)", async () => {
    const res = makeRes();
    await osfManage(
      makeReq({ body: { action: "disconnect", uid: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.success).toBe(true);

    const userRef = fs.getRef("users/u1");
    const [body, opts] = userRef.set.mock.calls[0];
    // O-2: both osfTokens (OAuth) AND osfToken (manual) cleared
    expect(body.osfTokens).toBeNull();
    expect(body.osfToken).toBeNull();
    expect(body.osfTokenValid).toBe(false);
    expect(body.osfUserId).toBeNull();
    expect(body.osfUserName).toBeNull();
    expect(body.osfProjectId).toBeNull();
    expect(opts).toEqual({ merge: true });
  });
});

// ─── createComponent ───────────────────────────────────────────────────────
