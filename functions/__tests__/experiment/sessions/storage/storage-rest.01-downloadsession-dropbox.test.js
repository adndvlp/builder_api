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

describe("downloadSession — dropbox", () => {
  test("returns CSV body on 200", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: "col\nval" }]);
    const r = await downloadSession("dropbox", "tok", "/exp", "EID", "S1");
    expect(r).toEqual({ success: true, csv: "col\nval", filename: "EID_S1.csv" });

    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe("https://content.dropboxapi.com/2/files/download");
    const arg = JSON.parse(call.options.headers["Dropbox-API-Arg"]);
    expect(arg.path).toBe("/exp/EID_S1.csv");
  });

  test("404 returns 'Session not found'", async () => {
    fetchMock.__setMockResponses([{ status: 404, body: {} }]);
    const r = await downloadSession("dropbox", "tok", "/exp", "EID", "S1");
    expect(r).toEqual({ success: false, error: "Session not found" });
  });
});
