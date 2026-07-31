/**
 * Tier 3 — error/branch coverage for experiment/sessions/services/folder.js.
 *
 * Targets the uncovered paths flagged in coverage:
 *   - createFolder dropbox: non-conflict 4xx / 5xx + 409 non-conflict tag
 *   - createFolder googledrive: empty path validation
 *   - createFolder osf: list-children non-ok → falls through to create
 *   - createFolder osf: create-node 4xx → failure with errorCode
 *   - createFolder outer catch (fetch throws)
 *   - createFolder unknown provider
 *   - deleteFolder dropbox: happy path (200) + non-200 failure
 *   - deleteFolder googledrive: empty path + DELETE non-ok
 *   - deleteFolder outer catch + unknown provider
 */
import fetchMock from "../../../helpers/fetch-mock.js";
import {
  createFolder,
  deleteFolder,
} from "../../../../experiment/sessions/services/folder.js";

beforeEach(() => {
  fetchMock.__reset();
});

// ─── createFolder — dropbox error branches ───────────────────────────────
describe("createFolder — dropbox error branches", () => {
  test("5xx returns failure with errorCode + errorText", async () => {
    fetchMock.__setMockResponses([
      { status: 500, body: { error_summary: "dbx down" } },
    ]);
    const r = await createFolder("dropbox", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
    expect(r.errorText).toBe("dbx down");
  });

  test("409 with non-conflict tag is treated as failure (not alreadyExists)", async () => {
    fetchMock.__setMockResponses([
      {
        status: 409,
        body: {
          error: { ".tag": "other_error" },
          error_summary: "other",
        },
      },
    ]);
    const r = await createFolder("dropbox", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(409);
    expect(r.errorText).toBe("other");
  });

  test("4xx with no error_summary falls back to statusText", async () => {
    fetchMock.__setMockResponses([
      { status: 401, body: {}, statusText: "Unauthorized" },
    ]);
    const r = await createFolder("dropbox", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(401);
    expect(r.errorText).toBe("Unauthorized");
  });
});

// ─── createFolder — googledrive ──────────────────────────────────────────
describe("createFolder — googledrive error branches", () => {
  test("empty path '/' returns 'Invalid folder path'", async () => {
    const r = await createFolder("googledrive", "tok", "/");
    expect(r.success).toBe(false);
    // F-2 fix rejects "/" earlier with a stricter message
    expect(r.errorText).toMatch(/Invalid folder/);
    // No fetch should be issued in this branch
    expect(fetchMock.__getCalls()).toHaveLength(0);
  });
});

// ─── createFolder — osf error branches ───────────────────────────────────
describe("createFolder — osf error branches", () => {
  test("list children non-ok → falls through and creates new component", async () => {
    fetchMock.__setMockResponses([
      { status: 500, body: {} }, // list 500 → skip reuse branch
      {
        status: 201,
        body: {
          data: {
            id: "fallbackCompId",
            relationships: {
              files: { links: { related: { href: "https://files.url" } } },
            },
          },
        },
      },
      {
        status: 200,
        body: { data: [{ links: { upload: "https://upload-new.url" } }] },
      },
    ]);
    const r = await createFolder("osf", "tok", "projectId", "ExpName");
    expect(r.success).toBe(true);
    expect(r.componentId).toBe("fallbackCompId");
    expect(r.uploadLink).toBe("https://upload-new.url");
    expect(r.alreadyExists).toBeUndefined();
  });

  test("create-node 4xx returns errorCode + errorText from errors[0].detail", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { data: [] } }, // list empty
      {
        status: 422,
        body: { errors: [{ detail: "rate limited" }] },
      },
    ]);
    const r = await createFolder("osf", "tok", "projectId", "ExpName");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(422);
    expect(r.errorText).toMatch(/rate limited/);
  });

  test("create-node 4xx without errors[0].detail → generic message", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { data: [] } },
      { status: 500, body: {} },
    ]);
    const r = await createFolder("osf", "tok", "projectId", "ExpName");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
    expect(r.errorText).toBe("Error creating OSF component");
  });
});

// ─── createFolder — outer catch + unknown provider ──────────────────────
describe("createFolder — outer catch + unknown provider", () => {
  test("fetch throw → outer catch returns failure with error message", async () => {
    fetchMock.__setMockResponses([
      () => {
        throw new Error("network unreachable");
      },
    ]);
    const r = await createFolder("dropbox", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorText).toMatch(/network unreachable/);
  });

  test("unknown provider returns 'Unknown provider'", async () => {
    const r = await createFolder("s3", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Unknown provider");
    expect(fetchMock.__getCalls()).toHaveLength(0);
  });
});

// ─── deleteFolder — dropbox ──────────────────────────────────────────────
describe("deleteFolder — dropbox", () => {
  test("200 → success with metadata", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { metadata: { id: "deleted" } } },
    ]);
    const r = await deleteFolder("dropbox", "tok", "/X");
    expect(r.success).toBe(true);
    expect(r.metadata.id).toBe("deleted");
  });

  test("non-200 → failure with errorCode + error_summary", async () => {
    fetchMock.__setMockResponses([
      { status: 409, body: { error_summary: "path/not_found/." } },
    ]);
    const r = await deleteFolder("dropbox", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(409);
    expect(r.errorText).toBe("path/not_found/.");
  });

  test("non-200 no error_summary → statusText fallback", async () => {
    fetchMock.__setMockResponses([
      { status: 401, body: {}, statusText: "Unauthorized" },
    ]);
    const r = await deleteFolder("dropbox", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Unauthorized");
  });
});

// ─── deleteFolder — googledrive ──────────────────────────────────────────
describe("deleteFolder — googledrive error branches", () => {
  test("empty path '/' returns 'Invalid folder path'", async () => {
    const r = await deleteFolder("googledrive", "tok", "/");
    expect(r.success).toBe(false);
    // F-2 fix rejects "/" earlier with a stricter message
    expect(r.errorText).toMatch(/Invalid folder/);
    expect(fetchMock.__getCalls()).toHaveLength(0);
  });

  test("DELETE returns 4xx → failure with errorCode + errorText", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "fld" }] } },
      { status: 403, body: { error: { message: "no perm" } } },
    ]);
    const r = await deleteFolder("googledrive", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(403);
    expect(r.errorText).toBe("no perm");
  });

  test("DELETE 4xx without error.message → generic message", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "fld" }] } },
      { status: 500, body: {} },
    ]);
    const r = await deleteFolder("googledrive", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
    expect(r.errorText).toBe("Error deleting folder");
  });
});

// ─── deleteFolder — outer catch + unknown provider ───────────────────────
describe("deleteFolder — outer catch + unknown provider", () => {
  test("fetch throw → outer catch returns failure with error message", async () => {
    fetchMock.__setMockResponses([
      () => {
        throw new Error("net err");
      },
    ]);
    const r = await deleteFolder("dropbox", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorText).toMatch(/net err/);
  });

  test("unknown provider returns 'Unknown provider'", async () => {
    const r = await deleteFolder("s3", "tok", "/X");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Unknown provider");
    expect(fetchMock.__getCalls()).toHaveLength(0);
  });
});
