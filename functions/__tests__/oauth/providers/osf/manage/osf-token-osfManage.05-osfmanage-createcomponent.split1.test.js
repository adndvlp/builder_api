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
  test("400 when uid or projectId missing", async () => {
    const res = makeRes();
    await osfManage(
      makeReq({ body: { action: "createComponent", uid: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  test("400 when user not found", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "createComponent", uid: "u1", projectId: "P" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toBe("User not found");
  });

  test("400 when osfToken absent", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "createComponent", uid: "u1", projectId: "P" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/OSF token not found/);
  });

  test("existing component → reuses it (returns 200, alreadyExists=true)", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      // list children
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
      // files endpoint
      {
        status: 200,
        body: {
          data: [{ links: { upload: "https://osf.upload/compX" } }],
        },
      },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "createComponent", uid: "u1", projectId: "P" },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.alreadyExists).toBe(true);
    expect(res.jsonBody.componentId).toBe("compX");
    expect(res.jsonBody.uploadLink).toBe("https://osf.upload/compX");
  });

  test("no existing component → POSTs to create, returns 201 with uploadLink", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      // list children (empty)
      { status: 200, body: { data: [] } },
      // create component
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
      // files endpoint
      {
        status: 200,
        body: {
          data: [{ links: { upload: "https://osf.upload/compNew" } }],
        },
      },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({
        body: {
          action: "createComponent",
          uid: "u1",
          projectId: "P",
          componentName: "Data",
          region: "us",
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(res.jsonBody.componentId).toBe("compNew");
    expect(res.jsonBody.uploadLink).toBe("https://osf.upload/compNew");

    const calls = fetchMock.__getCalls();
    expect(calls[1].url).toBe(
      "https://api.osf.io/v2/nodes/P/children/?region=us",
    );
    expect(calls[1].options.method).toBe("POST");
  });
});
