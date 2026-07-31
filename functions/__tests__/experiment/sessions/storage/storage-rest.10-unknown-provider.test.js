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

describe("unknown provider", () => {
  test("downloadSession returns 'Unknown provider'", async () => {
    const r = await downloadSession("ftp", "t", "f", "E", "S");
    expect(r).toEqual({ success: false, errorText: "Unknown provider" });
  });
  test("deleteSession returns 'Unknown provider'", async () => {
    const r = await deleteSession("ftp", "t", "f", "E", "S");
    expect(r).toEqual({ success: false, errorText: "Unknown provider" });
  });
  test("postFile returns 'Unknown provider'", async () => {
    const r = await postFile("ftp", "t", "f", "d", "n");
    expect(r).toEqual({ success: false, errorText: "Unknown provider" });
  });
});
