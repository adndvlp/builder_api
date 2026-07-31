/**
 * Characterization tests for storage.js::appendResult.
 * Focus: OSF's delete-then-create pattern (St-3) and Drive's create-on-miss.
 */
import fetchMock from "../../../helpers/fetch-mock.js";
import { appendResult } from "../../../../experiment/sessions/storage.js";

beforeEach(() => {
  fetchMock.__reset();
});

describe("appendResult — dropbox", () => {
  test("uploads with mode overwrite (St-2: can pisar datos en concurrencia)", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { id: "u1", path_lower: "/exp/EID_SID.csv" } }, // upload
      { status: 200, body: { url: "https://share/link" } }, // share
    ]);
    const r = await appendResult("dropbox", "tok", "/exp", "EID", "SID", "h\n1,2");
    expect(r.success).toBe(true);
    expect(r.fileUrl).toBe("https://share/link");

    const uploadCall = fetchMock.__getCalls()[0];
    const args = JSON.parse(uploadCall.options.headers["Dropbox-API-Arg"]);
    // PIN current behavior — overwrite mode, race risk documented in St-2
    expect(args.mode).toBe("overwrite");
  });

  test("returns success even if share-link fetch fails (link is optional)", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { id: "u1", path_lower: "/exp/file" } },
      { status: 500, body: {} },
    ]);
    const r = await appendResult("dropbox", "tok", "/exp", "EID", "SID", "csv");
    expect(r.success).toBe(true);
    expect(r.fileUrl).toBeNull();
  });
});

describe("appendResult — googledrive", () => {
  test("creates new file via multipart when search returns empty", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [] } }, // search
      { status: 200, body: { id: "drv-new" } }, // multipart create
    ]);
    const r = await appendResult("googledrive", "tok", "folder", "EID", "SID", "csv-data");
    expect(r.success).toBe(true);
    expect(r.id).toBe("drv-new");
  });

  test("PATCH existing file when search returns one", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "drv-existing" }] } },
      { status: 200, body: {} },
    ]);
    const r = await appendResult("googledrive", "tok", "folder", "EID", "SID", "csv");
    expect(r.success).toBe(true);
    expect(r.id).toBe("drv-existing");

    const patchCall = fetchMock.__getCalls()[1];
    expect(patchCall.options.method).toBe("PATCH");
    expect(patchCall.url).toContain("drv-existing");
  });
});

describe("appendResult — osf", () => {
  test("St-3 FIX: when file exists, PUT to file's upload URL (atomic new version, no DELETE)", async () => {
    const existingUploadUrl =
      "https://files.osf.io/v1/resources/abc/providers/osfstorage/oldFileId";
    fetchMock.__setMockResponses([
      // GET list files (find existing) — return the upload link, not delete
      {
        status: 200,
        body: {
          data: [
            {
              attributes: { name: "EID_SID.csv" },
              links: { upload: existingUploadUrl },
            },
          ],
        },
      },
      // PUT to existing upload URL → creates new version atomically
      {
        status: 200,
        body: {
          data: { id: "osf-new-version", links: { download: "https://osf/d" } },
        },
      },
    ]);
    const r = await appendResult(
      "osf",
      "tok",
      "https://files.osf.io/v1/resources/abc/providers/osfstorage/",
      "EID",
      "SID",
      "csv-data",
    );
    expect(r.success).toBe(true);
    expect(r.id).toBe("osf-new-version");

    const calls = fetchMock.__getCalls();
    // Exactly 2 calls: GET (list) + PUT (versioned upload). NO DELETE.
    expect(calls).toHaveLength(2);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[1].options.method).toBe("PUT");
    expect(calls[1].url).toBe(existingUploadUrl);
    expect(calls.some((c) => c.options.method === "DELETE")).toBe(false);
  });

  test("St-3 FIX: when file does NOT exist, PUT to folder uploadLink with name param", async () => {
    fetchMock.__setMockResponses([
      // GET list files → empty
      { status: 200, body: { data: [] } },
      // PUT new file to folder
      {
        status: 201,
        body: {
          data: { id: "osf-fresh", links: { download: "https://osf/dl" } },
        },
      },
    ]);
    const r = await appendResult(
      "osf",
      "tok",
      "https://files.osf.io/v1/resources/abc/providers/osfstorage/",
      "EID",
      "SID",
      "csv-data",
    );
    expect(r.success).toBe(true);
    expect(r.id).toBe("osf-fresh");
    const calls = fetchMock.__getCalls();
    expect(calls[1].url).toContain("name=EID_SID.csv");
    expect(calls.some((c) => c.options.method === "DELETE")).toBe(false);
  });

  test("St-3 FIX: if PUT fails, OLD file is NOT deleted (data preserved)", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          data: [
            {
              attributes: { name: "EID_SID.csv" },
              links: {
                upload:
                  "https://files.osf.io/v1/resources/abc/providers/osfstorage/old",
              },
            },
          ],
        },
      },
      { status: 500, body: "upload failed" }, // PUT FAIL
    ]);
    const r = await appendResult(
      "osf",
      "tok",
      "https://files.osf.io/v1/resources/abc/providers/osfstorage/",
      "EID",
      "SID",
      "csv",
    );
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
    // Critical safety property: NO DELETE call was made — old file intact.
    const calls = fetchMock.__getCalls();
    expect(calls.some((c) => c.options.method === "DELETE")).toBe(false);
  });

  test("returns failure when uploadLink is empty", async () => {
    const r = await appendResult("osf", "tok", "", "EID", "SID", "csv");
    expect(r.success).toBe(false);
    expect(r.errorText).toMatch(/OSF upload link is not configured/);
  });
});
