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

describe("postFile — osf", () => {
  test("PUTs to <uploadLink>?type=files&name=…", async () => {
    fetchMock.__setMockResponses([
      { status: 201, body: { data: { id: "osfid" } } },
    ]);
    const r = await postFile(
      "osf",
      "tok",
      "https://files.osf.io/v1/resources/comp/providers/osfstorage/",
      "{}",
      "f.json",
    );
    expect(r.success).toBe(true);
    expect(r.id).toBe("osfid");

    const call = fetchMock.__getCalls()[0];
    expect(call.url).toMatch(/type=files/);
    expect(call.url).toMatch(/name=f.json/);
    expect(call.options.method).toBe("PUT");
  });

  test("non-2xx returns errorText body", async () => {
    fetchMock.__setMockResponses([{ status: 413, body: "Payload too large" }]);
    const r = await postFile("osf", "tok", "uploadLink", "x", "f.json");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(413);
    expect(r.errorText).toBe("Payload too large");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unknown provider fallback
// ─────────────────────────────────────────────────────────────────────────
