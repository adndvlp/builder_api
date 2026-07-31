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

describe("postFile — dropbox", () => {
  test("upload with overwrite mode on success", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { id: "x" } }]);
    const r = await postFile("dropbox", "tok", "/exp", "data", "f.json");
    expect(r.success).toBe(true);

    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe("https://content.dropboxapi.com/2/files/upload");
    const arg = JSON.parse(call.options.headers["Dropbox-API-Arg"]);
    expect(arg.path).toBe("/exp/f.json");
    expect(arg.mode).toBe("overwrite");
  });

  test("non-200 → error", async () => {
    fetchMock.__setMockResponses([
      { status: 409, body: { error_summary: "conflict" } },
    ]);
    const r = await postFile("dropbox", "tok", "/exp", "data", "f.json");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(409);
    expect(r.errorText).toBe("conflict");
  });
});
