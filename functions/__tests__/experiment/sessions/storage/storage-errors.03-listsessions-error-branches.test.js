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

describe("listSessions — error branches", () => {
  test("dropbox: list_folder non-200 → failure with errorCode", async () => {
    fetchMock.__setMockResponses([
      { status: 500, body: { error_summary: "dbx err" } },
    ]);
    const r = await listSessions("dropbox", "tok", "/x", "EID");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
    expect(r.errorText).toBe("dbx err");
    expect(r.sessions).toEqual([]);
  });

  test("googledrive: !ok → failure with errorCode + errorText", async () => {
    fetchMock.__setMockResponses([
      { status: 500, body: { error: { message: "drive err" } } },
    ]);
    const r = await listSessions("googledrive", "tok", "fid", "EID");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
    expect(r.errorText).toBe("drive err");
  });

  test("osf: nodeResponse !ok → failure 'Error accessing OSF component'", async () => {
    fetchMock.__setMockResponses([{ status: 401, body: {} }]);
    const r = await listSessions("osf", "tok", "compId", "EID");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Error accessing OSF component");
    expect(r.errorCode).toBe(401);
  });

  test("osf: no osfstorage provider → success with empty sessions", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { data: [{ attributes: { name: "github" } }] } },
    ]);
    const r = await listSessions("osf", "tok", "compId", "EID");
    expect(r.success).toBe(true);
    expect(r.sessions).toEqual([]);
  });

  test("osf: filesResponse !ok → failure 'Error listing files'", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          data: [
            {
              attributes: { name: "osfstorage" },
              relationships: {
                files: { links: { related: { href: "https://files.url" } } },
              },
            },
          ],
        },
      },
      { status: 500, body: {} },
    ]);
    const r = await listSessions("osf", "tok", "compId", "EID");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Error listing files");
    expect(r.errorCode).toBe(500);
  });

  test("osf: sort sessions by date_created desc", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          data: [
            {
              attributes: { name: "osfstorage" },
              relationships: {
                files: { links: { related: { href: "https://files.url" } } },
              },
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          data: [
            {
              id: "a",
              attributes: {
                kind: "file",
                name: "EID_old.csv",
                date_created: "2025-01-01",
              },
            },
            {
              id: "b",
              attributes: {
                kind: "file",
                name: "EID_new.csv",
                date_created: "2025-02-01",
              },
            },
          ],
        },
      },
    ]);
    const r = await listSessions("osf", "tok", "compId", "EID");
    expect(r.success).toBe(true);
    expect(r.sessions[0].sessionId).toBe("new");
    expect(r.sessions[1].sessionId).toBe("old");
  });

  test("unknown provider → 'Unknown provider'", async () => {
    const r = await listSessions("s3", "tok", "x", "EID");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Unknown provider");
    expect(r.sessions).toEqual([]);
  });
});

// ─── downloadSession error branches ──────────────────────────────────────
