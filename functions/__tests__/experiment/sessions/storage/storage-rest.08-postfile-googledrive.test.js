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

describe("postFile — googledrive", () => {
  test("multipart upload with metadata using application/json mime", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { id: "drvId" } }]);
    const r = await postFile("googledrive", "tok", "fldX", '{"x":1}', "f.json");
    expect(r.success).toBe(true);
    expect(r.id).toBe("drvId");

    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    );
    expect(call.options.headers["Content-Type"]).toMatch(/multipart\/related/);
    // body should include the metadata parents=[fldX] AND the file body
    expect(call.options.body).toContain('"parents":["fldX"]');
    expect(call.options.body).toContain('"name":"f.json"');
    expect(call.options.body).toContain('{"x":1}');
  });

  test("4xx returns error.message", async () => {
    fetchMock.__setMockResponses([
      { status: 400, body: { error: { message: "Bad" } } },
    ]);
    const r = await postFile("googledrive", "tok", "fldX", "x", "f");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Bad");
    expect(r.errorCode).toBe(400);
  });
});
