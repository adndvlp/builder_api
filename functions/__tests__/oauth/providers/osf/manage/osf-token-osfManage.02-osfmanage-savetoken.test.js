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

describe("osfManage — saveToken", () => {
  test("400 when uid or token missing", async () => {
    const res = makeRes();
    await osfManage(
      makeReq({ body: { action: "saveToken", uid: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/uid or token/);
  });

  test("400 when projectId missing", async () => {
    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "saveToken", uid: "u1", token: "T" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/projectId/);
  });

  test("400 when token invalid (validateOSFToken returns valid:false)", async () => {
    fetchMock.__setMockResponses([{ status: 401, body: {} }]);
    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "saveToken", uid: "u1", token: "T", projectId: "P" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toBe("Invalid OSF token");
  });

  test("O-3 FIX: 400 when token has read-only access (no write/admin in permissions)", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { data: { id: "u", attributes: { full_name: "F" } } } },
      {
        status: 200,
        body: {
          data: { attributes: { current_user_permissions: ["read"] } },
        },
      },
    ]);
    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "saveToken", uid: "u1", token: "T", projectId: "P" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/write access/);
  });

  test("400 when projectId invalid (project GET non-ok)", async () => {
    fetchMock.__setMockResponses([
      // validateOSFToken: ok
      { status: 200, body: { data: { id: "u", attributes: { full_name: "F" } } } },
      // project: 404
      { status: 404, body: {} },
    ]);
    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "saveToken", uid: "u1", token: "T", projectId: "bad" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Invalid OSF Project ID/);
  });

  test("happy path → validates token + project + write scope, saves to Firestore, returns 200", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: { data: { id: "usr1", attributes: { full_name: "Alice" } } },
      },
      {
        status: 200,
        body: {
          data: { attributes: { current_user_permissions: ["admin"] } },
        },
      },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "saveToken", uid: "u1", token: "T", projectId: "P1" },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.userId).toBe("usr1");
    expect(res.jsonBody.userName).toBe("Alice");

    const userRef = fs.getRef("users/u1");
    const [body, opts] = userRef.set.mock.calls[0];
    expect(body.osfToken).toBe("T");
    expect(body.osfTokenValid).toBe(true);
    expect(body.osfProjectId).toBe("P1");
    expect(body.osfUserId).toBe("usr1");
    expect(body.osfUserName).toBe("Alice");
    expect(opts).toEqual({ merge: true });
  });
});

// ─── validateToken ─────────────────────────────────────────────────────────
