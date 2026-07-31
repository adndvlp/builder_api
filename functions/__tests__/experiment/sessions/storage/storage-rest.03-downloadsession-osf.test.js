/**
 * Tests for the storage.js functions not covered elsewhere:
 *   - downloadSession (3 providers)
 *   - deleteSession (3 providers)
 *   - postFile (3 providers, legacy)
 *   - Unknown-provider fallback
 *
 * createSession/appendResult/listSessions are covered in their own files.
 */
import fetchMock from "../../../helpers/fetch-mock.js";
import {
  downloadSession,
  deleteSession,
  postFile,
} from "../../../../experiment/sessions/storage.js";

beforeEach(() => {
  fetchMock.__reset();
});

// ─────────────────────────────────────────────────────────────────────────
// downloadSession
// ─────────────────────────────────────────────────────────────────────────

describe("downloadSession — osf", () => {
  test("walks node → osfstorage provider → files → download link", async () => {
    fetchMock.__setMockResponses([
      // GET /nodes/<comp>/files/ — storage providers list
      {
        status: 200,
        body: {
          data: [
            {
              attributes: { name: "osfstorage" },
              relationships: {
                files: { links: { related: { href: "https://api.osf/files-link" } } },
              },
            },
          ],
        },
      },
      // GET files-link → file list
      {
        status: 200,
        body: {
          data: [
            {
              attributes: { name: "EID_S1.csv" },
              links: { download: "https://api.osf/download/EID_S1" },
            },
          ],
        },
      },
      // GET download link
      { status: 200, body: "col\n1" },
    ]);
    const r = await downloadSession("osf", "tok", "comp42", "EID", "S1");
    expect(r).toEqual({ success: true, csv: "col\n1", filename: "EID_S1.csv" });

    // confirm the first fetch hit the componentId-based URL
    expect(fetchMock.__getCalls()[0].url).toBe(
      "https://api.osf.io/v2/nodes/comp42/files/",
    );
  });

  test("returns 'Session not found' when target file missing in OSF list", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          data: [
            {
              attributes: { name: "osfstorage" },
              relationships: {
                files: { links: { related: { href: "https://api.osf/files-link" } } },
              },
            },
          ],
        },
      },
      {
        status: 200,
        body: { data: [{ attributes: { name: "OTHER_S1.csv" }, links: {} }] },
      },
    ]);
    const r = await downloadSession("osf", "tok", "comp42", "EID", "S1");
    expect(r).toEqual({ success: false, errorText: "Session not found" });
  });

  test("returns error when node fetch fails", async () => {
    fetchMock.__setMockResponses([{ status: 403, body: {} }]);
    const r = await downloadSession("osf", "tok", "comp42", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// deleteSession
// ─────────────────────────────────────────────────────────────────────────
