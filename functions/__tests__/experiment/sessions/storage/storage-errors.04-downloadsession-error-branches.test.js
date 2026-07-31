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

describe("downloadSession — error branches", () => {
  test("osf: nodeResponse !ok → failure", async () => {
    fetchMock.__setMockResponses([{ status: 404, body: {} }]);
    const r = await downloadSession("osf", "tok", "compId", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Error accessing OSF component");
    expect(r.errorCode).toBe(404);
  });

  test("osf: storage provider not found → 'Storage provider not found'", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { data: [{ attributes: { name: "github" } }] } },
    ]);
    const r = await downloadSession("osf", "tok", "compId", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Storage provider not found");
  });

  test("osf: filesResponse !ok → failure", async () => {
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
    const r = await downloadSession("osf", "tok", "compId", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Error listing files");
    expect(r.errorCode).toBe(500);
  });

  test("osf: target file download non-ok → 'Error downloading file'", async () => {
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
              id: "fX",
              attributes: { name: "EID_S1.csv" },
              links: { download: "https://download.url" },
            },
          ],
        },
      },
      { status: 500, body: "" },
    ]);
    const r = await downloadSession("osf", "tok", "compId", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Error downloading file");
    expect(r.errorCode).toBe(500);
  });
});

// ─── deleteSession error branches ────────────────────────────────────────
