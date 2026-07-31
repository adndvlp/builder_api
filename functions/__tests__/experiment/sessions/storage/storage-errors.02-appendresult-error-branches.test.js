/**
 * Fast wins for experiment/sessions/storage.js — error branches across
 * createSession, appendResult, listSessions, downloadSession, deleteSession,
 * postFile, and all "Unknown provider" tails.
 *
 * Targets scattered uncovered lines:
 *   140, 228-229, 259, 317-318, 345-346, 390, 442, 476-477, 522-523,
 *   565, 579, 592, 625, 738, 751, 777, 868-869, 893, 906, 919, 945, etc.
 */
import fetchMock from "../../../helpers/fetch-mock.js";
import {
  createSession,
  appendResult,
  listSessions,
  downloadSession,
  deleteSession,
  postFile,
} from "../../../../experiment/sessions/storage.js";

beforeEach(() => {
  fetchMock.__reset();
});

// ─── createSession error branches ────────────────────────────────────────

describe("appendResult — error branches", () => {
  test("dropbox: upload non-200 returns failure", async () => {
    fetchMock.__setMockResponses([
      { status: 500, body: { error_summary: "dbx down" } },
    ]);
    const r = await appendResult("dropbox", "tok", "/x", "EID", "S1", "csv");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
    expect(r.errorText).toBe("dbx down");
  });

  test("dropbox: 409 shared_link_already_exists → fileUrl from metadata", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { id: "u1", path_lower: "/x/EID_S1.csv" } },
      {
        status: 409,
        body: {
          shared_link_already_exists: {
            metadata: { url: "https://dbx.share/already" },
          },
        },
      },
    ]);
    const r = await appendResult("dropbox", "tok", "/x", "EID", "S1", "csv");
    expect(r.success).toBe(true);
    expect(r.fileUrl).toBe("https://dbx.share/already");
  });

  test("googledrive: create new file non-ok → failure", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [] } }, // not exist
      { status: 500, body: { error: { message: "create fail" } } },
    ]);
    const r = await appendResult("googledrive", "tok", "fid", "EID", "S1", "csv");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("create fail");
    expect(r.errorCode).toBe(500);
  });

  test("googledrive: PATCH existing file non-ok → failure", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "exists" }] } },
      { status: 500, body: { error: { message: "patch fail" } } },
    ]);
    const r = await appendResult("googledrive", "tok", "fid", "EID", "S1", "csv");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("patch fail");
  });

  test("googledrive: PATCH non-ok no error.message → generic 'Error updating file'", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "exists" }] } },
      { status: 502, body: {} },
    ]);
    const r = await appendResult("googledrive", "tok", "fid", "EID", "S1", "csv");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Error updating file");
  });

  test("osf: lookup throws → log + falls through to create-new attempt", async () => {
    fetchMock.__setMockResponses([
      // list files → throw
      () => {
        throw new Error("lookup boom");
      },
      // create new file → succeeds
      {
        status: 201,
        body: {
          data: { id: "fresh", links: { download: "https://osf/d" } },
        },
      },
    ]);
    const r = await appendResult(
      "osf",
      "tok",
      "https://files.osf.io/v1/resources/c/providers/osfstorage/",
      "EID",
      "S1",
      "csv",
    );
    expect(r.success).toBe(true);
    expect(r.id).toBe("fresh");
  });

  test("unknown provider → 'Unknown provider'", async () => {
    const r = await appendResult("s3", "tok", "x", "EID", "S1", "csv");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Unknown provider");
  });
});

// ─── listSessions error branches ─────────────────────────────────────────
