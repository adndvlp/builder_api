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

describe("downloadSession — googledrive", () => {
  test("searches by name+parent, downloads by fileId on hit", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "fid42" }] } },
      { status: 200, body: "col\n1" },
    ]);
    const r = await downloadSession("googledrive", "tok", "fldX", "EID", "S1");
    expect(r).toEqual({ success: true, csv: "col\n1" });

    const downloadCall = fetchMock.__getCalls()[1];
    expect(downloadCall.url).toBe(
      "https://www.googleapis.com/drive/v3/files/fid42?alt=media",
    );
  });

  test("404 when search returns no files", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { files: [] } }]);
    const r = await downloadSession("googledrive", "tok", "fldX", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(404);
  });

  test("propagates 5xx from download", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "fid" }] } },
      { status: 500, body: "" },
    ]);
    const r = await downloadSession("googledrive", "tok", "fldX", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(500);
  });
});
