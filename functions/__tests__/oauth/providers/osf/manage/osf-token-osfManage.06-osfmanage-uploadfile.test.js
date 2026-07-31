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

describe("osfManage — uploadFile", () => {
  test("400 when any required param missing", async () => {
    const res = makeRes();
    await osfManage(
      makeReq({
        body: { action: "uploadFile", uid: "u1", uploadLink: "x", filename: "f" },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Missing required parameters/);
  });

  test("400 when user not found", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await osfManage(
      makeReq({
        body: {
          action: "uploadFile",
          uid: "u1",
          uploadLink: "https://up.link/",
          filename: "f.csv",
          fileContent: "a,b,c\n1,2,3",
        },
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
        body: {
          action: "uploadFile",
          uid: "u1",
          uploadLink: "https://up.link/",
          filename: "f.csv",
          fileContent: "a",
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/OSF token/);
  });

  test("happy path → PUTs file with query params, returns 201 with fileId + fileUrl", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      {
        status: 201,
        body: {
          data: { id: "file1", links: { download: "https://osf.io/dl/file1" } },
        },
      },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({
        body: {
          action: "uploadFile",
          uid: "u1",
          uploadLink: "https://up.link/",
          filename: "results.csv",
          fileContent: "a,b\n1,2",
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(res.jsonBody.fileId).toBe("file1");
    expect(res.jsonBody.fileUrl).toBe("https://osf.io/dl/file1");

    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe(
      "https://up.link/?type=files&name=results.csv",
    );
    expect(call.options.method).toBe("PUT");
    expect(call.options.body).toBe("a,b\n1,2");
  });

  test("uploadLink with existing query → uses & separator (no double ?)", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      { status: 201, body: { data: { id: "f1" } } },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({
        body: {
          action: "uploadFile",
          uid: "u1",
          uploadLink: "https://files.osf.io/v1/resources/abc/providers/osfstorage/?kind=file",
          filename: "x.csv",
          fileContent: "a",
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe(
      "https://files.osf.io/v1/resources/abc/providers/osfstorage/?kind=file&type=files&name=x.csv",
    );
    // No double ? in URL
    expect(call.url.match(/\?/g)).toHaveLength(1);
  });

  test("upload non-ok → returns same status with errorText", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ osfToken: "T" }),
    });
    fetchMock.__setMockResponses([
      { status: 409, body: "conflict" },
    ]);

    const res = makeRes();
    await osfManage(
      makeReq({
        body: {
          action: "uploadFile",
          uid: "u1",
          uploadLink: "https://up.link/",
          filename: "x.csv",
          fileContent: "data",
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(409);
    expect(res.jsonBody.success).toBe(false);
    expect(res.jsonBody.statusCode).toBe(409);
  });
});
