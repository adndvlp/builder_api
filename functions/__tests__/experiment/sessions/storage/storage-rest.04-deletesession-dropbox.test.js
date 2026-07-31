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

describe("deleteSession — dropbox", () => {
  test("POSTs /files/delete_v2 with full file path; success on 200", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: {} }]);
    const r = await deleteSession("dropbox", "tok", "/exp", "EID", "S1");
    expect(r).toEqual({ success: true });

    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe("https://api.dropboxapi.com/2/files/delete_v2");
    expect(JSON.parse(call.options.body)).toEqual({
      path: "/exp/EID_S1.csv",
    });
  });

  test("error propagated when status != 200", async () => {
    fetchMock.__setMockResponses([
      { status: 409, body: { error_summary: "path/not_found" } },
    ]);
    const r = await deleteSession("dropbox", "tok", "/exp", "EID", "S1");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(409);
    expect(r.errorText).toBe("path/not_found");
  });
});
