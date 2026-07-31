/**
 * Tests for experiment/sessions/services/folder.js — createFolder + deleteFolder.
 * Verifies F-1 (Drive root filter) and F-3 (OSF deleteFolder files-only) fixes.
 */
import fetchMock from "../../../helpers/fetch-mock.js";
import { createFolder, deleteFolder } from "../../../../experiment/sessions/services/folder.js";

beforeEach(() => {
  fetchMock.__reset();
});

// ─── Drive: F-1 root filter on first iteration ────────────────────────────
describe("createFolder — googledrive (F-1 fix: root filter)", () => {
  test("first iteration query filters 'root' in parents (not any folder anywhere)", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "found-in-root" }] } },
    ]);
    await createFolder("googledrive", "tok", "/ExpBuilder");
    const url = fetchMock.__getCalls()[0].url;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("'root' in parents");
  });

  test("nested path: 2nd iteration uses the id from 1st iteration as parent", async () => {
    fetchMock.__setMockResponses([
      // 1st iter: ExpBuilder under root → found
      { status: 200, body: { files: [{ id: "expBuilderId" }] } },
      // 2nd iter: EID under expBuilderId → not found, then create
      { status: 200, body: { files: [] } },
      { status: 200, body: { id: "newSubId" } },
    ]);
    const r = await createFolder("googledrive", "tok", "/ExpBuilder/EID");
    expect(r.success).toBe(true);
    expect(r.folderId).toBe("newSubId");

    const calls = fetchMock.__getCalls();
    expect(decodeURIComponent(calls[0].url)).toContain("'root' in parents");
    expect(decodeURIComponent(calls[1].url)).toContain("'expBuilderId' in parents");
  });

  test("returns failure with errorCode when Drive create returns 4xx", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [] } }, // not found
      { status: 403, body: { error: { message: "denied" } } },
    ]);
    const r = await createFolder("googledrive", "tok", "/ExpBuilder");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(403);
  });
});

describe("deleteFolder — googledrive (F-1 fix: same root filter)", () => {
  test("first iteration query filters 'root' in parents", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "fld" }] } },
      { status: 204, body: {} },
    ]);
    await deleteFolder("googledrive", "tok", "/ExpBuilder");
    const url = fetchMock.__getCalls()[0].url;
    expect(decodeURIComponent(url)).toContain("'root' in parents");
  });

  test("returns success when folder doesn't exist (no-op)", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { files: [] } }]);
    const r = await deleteFolder("googledrive", "tok", "/ExpBuilder");
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/does not exist/);
  });
});

// ─── OSF: F-3 deleteFolder borrar files, no componente ────────────────────
describe("deleteFolder — osf (F-3 fix: files-only, not component)", () => {
  test("lists component files and DELETEs each (no DELETE to component itself)", async () => {
    fetchMock.__setMockResponses([
      // GET list files
      {
        status: 200,
        body: {
          data: [
            {
              id: "f1",
              attributes: { name: "EID_S1.csv" },
              links: { delete: "https://api.osf.io/v2/files/f1/" },
            },
            {
              id: "f2",
              attributes: { name: "EID_S2.csv" },
              links: { delete: "https://api.osf.io/v2/files/f2/" },
            },
          ],
        },
      },
      // DELETE each
      { status: 204, body: "" },
      { status: 204, body: "" },
    ]);

    const r = await deleteFolder("osf", "tok", "compId");
    expect(r.success).toBe(true);
    expect(r.deletedFiles).toBe(2);

    const calls = fetchMock.__getCalls();
    expect(calls).toHaveLength(3);

    // Critical: NO DELETE to nodes/<compId> — that would nuke the component
    expect(calls.some(
      (c) => c.options.method === "DELETE" && c.url.includes(`/nodes/compId`)
    )).toBe(false);

    // Both individual file deletes happened
    expect(calls[1].options.method).toBe("DELETE");
    expect(calls[1].url).toBe("https://api.osf.io/v2/files/f1/");
    expect(calls[2].options.method).toBe("DELETE");
    expect(calls[2].url).toBe("https://api.osf.io/v2/files/f2/");
  });

  test("empty component: GET returns no files → success with deletedFiles=0", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { data: [] } }]);
    const r = await deleteFolder("osf", "tok", "compId");
    expect(r.success).toBe(true);
    expect(r.deletedFiles).toBe(0);
    expect(fetchMock.__getCalls()).toHaveLength(1); // only the list
  });

  test("if some DELETEs fail, returns failure with list of failed names", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          data: [
            {
              id: "f1",
              attributes: { name: "good.csv" },
              links: { delete: "https://api.osf.io/v2/files/f1/" },
            },
            {
              id: "f2",
              attributes: { name: "bad.csv" },
              links: { delete: "https://api.osf.io/v2/files/f2/" },
            },
          ],
        },
      },
      { status: 204, body: "" },
      { status: 500, body: "" },
    ]);
    const r = await deleteFolder("osf", "tok", "compId");
    expect(r.success).toBe(false);
    expect(r.errorText).toMatch(/bad\.csv: 500/);
  });

  test("if list fails, returns failure with errorCode", async () => {
    fetchMock.__setMockResponses([{ status: 403, body: {} }]);
    const r = await deleteFolder("osf", "tok", "compId");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(403);
  });
});

// ─── OSF createFolder: reuse + create paths ──────────────────────────────
describe("createFolder — osf", () => {
  test("reuses existing component with same title", async () => {
    fetchMock.__setMockResponses([
      // list children → found "MyExp"
      {
        status: 200,
        body: {
          data: [
            {
              id: "existingCompId",
              attributes: { title: "MyExp" },
              relationships: {
                files: { links: { related: { href: "https://files.url" } } },
              },
            },
          ],
        },
      },
      // GET files of that component → returns upload link
      {
        status: 200,
        body: {
          data: [{ links: { upload: "https://upload.url" } }],
        },
      },
    ]);

    const r = await createFolder("osf", "tok", "projectId", "MyExp");
    expect(r.success).toBe(true);
    expect(r.alreadyExists).toBe(true);
    expect(r.componentId).toBe("existingCompId");
    expect(r.uploadLink).toBe("https://upload.url");
  });

  test("creates new component when title not found", async () => {
    fetchMock.__setMockResponses([
      // list children → no match
      { status: 200, body: { data: [] } },
      // create component
      {
        status: 201,
        body: {
          data: {
            id: "newCompId",
            relationships: {
              files: { links: { related: { href: "https://files.url" } } },
            },
          },
        },
      },
      // GET files of new component
      {
        status: 200,
        body: {
          data: [{ links: { upload: "https://upload-new.url" } }],
        },
      },
    ]);

    const r = await createFolder("osf", "tok", "projectId", "NewExp");
    expect(r.success).toBe(true);
    expect(r.componentId).toBe("newCompId");
    expect(r.uploadLink).toBe("https://upload-new.url");
    expect(r.alreadyExists).toBeUndefined();
  });
});

// ─── Dropbox createFolder ─────────────────────────────────────────────────
describe("createFolder — dropbox", () => {
  test("returns success on 200", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { metadata: { id: "f1" } } }]);
    const r = await createFolder("dropbox", "tok", "/ExpBuilder/EID");
    expect(r.success).toBe(true);
    expect(r.metadata.id).toBe("f1");
  });

  test("returns success with alreadyExists when folder conflict (409)", async () => {
    fetchMock.__setMockResponses([
      {
        status: 409,
        body: {
          error: { ".tag": "path", path: { ".tag": "conflict" } },
        },
      },
    ]);
    const r = await createFolder("dropbox", "tok", "/ExpBuilder/EID");
    expect(r.success).toBe(true);
    expect(r.alreadyExists).toBe(true);
  });
});
