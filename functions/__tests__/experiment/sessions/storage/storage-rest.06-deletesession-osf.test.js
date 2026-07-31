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

describe("deleteSession — osf", () => {
  test("walks node → osfstorage → files → DELETE link", async () => {
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
        body: {
          data: [
            {
              attributes: { name: "EID_S1.csv" },
              links: { delete: "https://api.osf/del/EID_S1" },
            },
          ],
        },
      },
      { status: 204, body: "" },
    ]);
    const r = await deleteSession("osf", "tok", "comp42", "EID", "S1");
    expect(r.success).toBe(true);

    expect(fetchMock.__getCalls()[2].url).toBe("https://api.osf/del/EID_S1");
    expect(fetchMock.__getCalls()[2].options.method).toBe("DELETE");
  });

  test("404 when target file not in OSF list", async () => {
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
      { status: 200, body: { data: [] } },
    ]);
    const r = await deleteSession("osf", "tok", "comp42", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// postFile (legacy)
// ─────────────────────────────────────────────────────────────────────────
