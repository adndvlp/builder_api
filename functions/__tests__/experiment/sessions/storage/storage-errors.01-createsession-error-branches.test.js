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

describe("createSession — error branches", () => {
  test("googledrive: !ok upload returns failure with errorCode + errorText", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [] } }, // search → not exist
      { status: 500, body: { error: { message: "drive 500" } } }, // upload fail
    ]);
    const r = await createSession("googledrive", "tok", "folderId", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
    expect(r.errorText).toBe("drive 500");
  });

  test("googledrive: 'session already exists' when search returns a match", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "exists" }] } },
    ]);
    const r = await createSession("googledrive", "tok", "folderId", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(409);
    expect(r.errorText).toBe("Session already exists");
  });

  test("googledrive: !ok with no error.message → generic 'Error creating session'", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [] } },
      { status: 502, body: {} },
    ]);
    const r = await createSession("googledrive", "tok", "folderId", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Error creating session");
  });

  test("dropbox: get_metadata 200 → 'Session already exists'", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { id: "abc" } }]);
    const r = await createSession("dropbox", "tok", "/exp", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.error).toBe("Session already exists");
  });

  test("dropbox: upload non-200 returns failure", async () => {
    fetchMock.__setMockResponses([
      { status: 404, body: {} }, // get_metadata: not found
      { status: 500, body: { error_summary: "fail/" } }, // upload err
    ]);
    const r = await createSession("dropbox", "tok", "/exp", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
    expect(r.errorText).toBe("fail/");
  });

  test("osf: !ok upload returns failure with text body", async () => {
    fetchMock.__setMockResponses([{ status: 500, body: "osf err" }]);
    const r = await createSession(
      "osf",
      "tok",
      "https://files.osf.io/v1/resources/c/providers/osfstorage/",
      "EID",
      "S1",
    );
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("osf err");
    expect(r.errorCode).toBe(500);
  });

  test("osf: !ok empty text → generic 'Error creating session'", async () => {
    fetchMock.__setMockResponses([{ status: 502, body: "" }]);
    const r = await createSession(
      "osf",
      "tok",
      "https://files.osf.io/v1/resources/c/providers/osfstorage/",
      "EID",
      "S1",
    );
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Error creating session");
  });

  test("unknown provider returns failure", async () => {
    const r = await createSession("s3", "tok", "x", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Unknown provider");
  });
});

// ─── appendResult error branches ─────────────────────────────────────────
