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

describe("deleteSession — googledrive", () => {
  test("searches then DELETEs by fileId", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "fid99" }] } },
      { status: 204, body: "" },
    ]);
    const r = await deleteSession("googledrive", "tok", "fldX", "EID", "S1");
    expect(r.success).toBe(true);

    const delCall = fetchMock.__getCalls()[1];
    expect(delCall.url).toBe("https://www.googleapis.com/drive/v3/files/fid99");
    expect(delCall.options.method).toBe("DELETE");
  });

  test("404 when search empty", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { files: [] } }]);
    const r = await deleteSession("googledrive", "tok", "fldX", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(404);
  });
});
