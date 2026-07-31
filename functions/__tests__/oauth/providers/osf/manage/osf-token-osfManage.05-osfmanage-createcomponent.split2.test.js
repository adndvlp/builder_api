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

describe("osfManage — createComponent", () => {
  test("existing component but filesResponse non-ok → returns same status with error (no crash)", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      // list children → 1 existing
      {
        status: 200,
        body: {
          data: [
            {
              id: "compX",
              attributes: { title: "Data" },
              relationships: {
                files: { links: { related: { href: "https://files-link" } } },
              },
            },
          ],
        },
      },
      // files endpoint fails
      { status: 401, body: "token revoked" },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "createComponent", uid: "u1", projectId: "P" },
      }),
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody.componentId).toBe("compX");
    expect(res.jsonBody.message).toMatch(/files endpoint for existing/);
  });

  test("created component but filesResponse non-ok → returns same status with error (no crash)", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      // list children empty
      { status: 200, body: { data: [] } },
      // create OK
      {
        status: 201,
        body: {
          data: {
            id: "compNew",
            relationships: {
              files: { links: { related: { href: "https://files-new" } } },
            },
          },
        },
      },
      // files endpoint fails
      { status: 500, body: "down" },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "createComponent", uid: "u1", projectId: "P" },
      }),
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.componentId).toBe("compNew");
    expect(res.jsonBody.message).toMatch(/files endpoint failed/);
  });

  test("created component but filesResponse returns unexpected shape → 502", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { data: [] } },
      {
        status: 201,
        body: {
          data: {
            id: "compX",
            relationships: {
              files: { links: { related: { href: "https://files" } } },
            },
          },
        },
      },
      // files endpoint OK but no data[].links.upload
      { status: 200, body: { data: [] } },
    ]);
    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "createComponent", uid: "u1", projectId: "P" },
      }),
      res,
    );
    expect(res.statusCode).toBe(502);
    expect(res.jsonBody.message).toMatch(/unexpected shape/);
  });

  test("createResponse non-ok → returns same status with error details", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      // list children — empty so falls through
      { status: 200, body: { data: [] } },
      // create — 403
      { status: 403, body: { errors: [{ detail: "forbidden" }] } },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "createComponent", uid: "u1", projectId: "P" },
      }),
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody.success).toBe(false);
    expect(res.jsonBody.error).toEqual([{ detail: "forbidden" }]);
  });
});
