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

describe("osfManage — validateToken", () => {
  test("400 when uid missing", async () => {
    const res = makeRes();
    await osfManage(
      makeReq({ query: { action: "validateToken" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/uid/);
  });

  test("400 when user not found", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await osfManage(
      makeReq({ query: { action: "validateToken", uid: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toBe("User not found");
  });

  test("400 when osfToken absent on user doc", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    const res = makeRes();
    await osfManage(
      makeReq({ query: { action: "validateToken", uid: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/OSF token not found/);
  });

  test("valid token → updates osfTokenValid=true, returns 200 with user info", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: { data: { id: "usr1", attributes: { full_name: "Alice" } } },
      },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({ query: { action: "validateToken", uid: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.valid).toBe(true);
    expect(res.jsonBody.userId).toBe("usr1");
    expect(res.jsonBody.userName).toBe("Alice");

    const userRef = fs.getRef("users/u1");
    expect(userRef.set).toHaveBeenCalledWith(
      { osfTokenValid: true },
      { merge: true },
    );
  });

  test("invalid token → updates osfTokenValid=false, returns valid:false", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([{ status: 401, body: {} }]);

    const res = makeRes();
    await osfManage(
      makeReq({ query: { action: "validateToken", uid: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.valid).toBe(false);
    expect(fs.getRef("users/u1").set).toHaveBeenCalledWith(
      { osfTokenValid: false },
      { merge: true },
    );
  });
});

// ─── disconnect ────────────────────────────────────────────────────────────
