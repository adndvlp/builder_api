/**
 * Tests for storage.js::createSession across providers.
 * St-7 (drop `participantNumber: 1` stub) and St-10 (align Dropbox conflict
 * with errorCode:409) are fixed; tests assert the corrected contract.
 * T-15 Drive query injection escape still pinned.
 */
import { jest } from "@jest/globals";
import fetchMock from "../../../helpers/fetch-mock.js";
import { createSession } from "../../../../experiment/sessions/storage.js";

beforeEach(() => {
  fetchMock.__reset();
});

describe("createSession — dropbox", () => {
  test("returns success with id on 200", async () => {
    fetchMock.__setMockResponses([
      // get_metadata check → 404 (not found)
      { status: 409, body: { error: "not_found" } },
      // upload → 200
      { status: 200, body: { id: "id:dbx-1" } },
    ]);
    const r = await createSession("dropbox", "tok", "/exp", "EID", "SID");
    expect(r).toEqual({ success: true, id: "id:dbx-1" });
    expect(fetchMock.__getCalls()).toHaveLength(2);
  });

  test("St-10 FIX: file already exists returns errorCode 409 + errorText (aligned with Drive)", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { id: "dbx-existing" } }]);
    const r = await createSession("dropbox", "tok", "/exp", "EID", "SID");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(409);
    expect(r.errorText).toBe("Session already exists");
    // Legacy `error` field preserved for callers that still read it
    expect(r.error).toBe("Session already exists");
  });

  test("propagates upload failure with statusText fallback", async () => {
    fetchMock.__setMockResponses([
      { status: 404, body: {} }, // metadata
      { status: 507, statusText: "Insufficient Storage", body: {} },
    ]);
    const r = await createSession("dropbox", "tok", "/exp", "EID", "SID");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(507);
    expect(r.errorText).toBe("Insufficient Storage");
  });
});

describe("createSession — googledrive", () => {
  test("returns success with id when no existing file", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [] } }, // search → none
      { status: 200, body: { id: "drv-1" } }, // upload
    ]);
    const r = await createSession("googledrive", "tok", "folderID", "EID", "SID");
    expect(r).toEqual({ success: true, id: "drv-1" });
  });

  test("returns errorCode 409 when file already exists", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [{ id: "found" }] } },
    ]);
    const r = await createSession("googledrive", "tok", "folderID", "EID", "SID");
    expect(r).toEqual({
      success: false,
      errorText: "Session already exists",
      errorCode: 409,
    });
  });

  test("T-15 FIX: Drive search query escapes single quotes in folderIdentifier", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { files: [] } },
      { status: 200, body: { id: "drv-x" } },
    ]);
    // folderIdentifier is an opaque token from Drive — sessionId/experimentID are
    // pre-validated (S-7), so the apostrophe-escape path is exercised here via
    // a folder ID containing `'`.
    await createSession("googledrive", "tok", "folder'INJ", "EID", "SID");
    const url = fetchMock.__getCalls()[0].url;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("'folder\\'INJ' in parents");
    expect(decoded).not.toContain("'folder'INJ' in parents");
  });

  test("S-7 FIX: createSession rejects experimentID containing path separator", async () => {
    const r = await createSession(
      "googledrive",
      "tok",
      "folderID",
      "EID/../traversal",
      "SID",
    );
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(400);
    expect(r.errorText).toMatch(/Invalid experimentID/);
  });

  test("S-7 FIX: createSession rejects sessionId with backslash", async () => {
    const r = await createSession(
      "googledrive",
      "tok",
      "folderID",
      "EID",
      "SID\\evil",
    );
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(400);
    expect(r.errorText).toMatch(/Invalid sessionId/);
  });
});

describe("createSession — osf", () => {
  test("returns success with id from data.id", async () => {
    fetchMock.__setMockResponses([
      { status: 201, body: { data: { id: "osf-1" } } },
    ]);
    const r = await createSession(
      "osf",
      "tok",
      "https://files.osf.io/v1/resources/abc/providers/osfstorage/",
      "EID",
      "SID",
    );
    expect(r).toEqual({ success: true, id: "osf-1" });
  });

  test("returns failure when OSF rejects", async () => {
    fetchMock.__setMockResponses([
      { status: 409, body: "conflict" },
    ]);
    const r = await createSession(
      "osf",
      "tok",
      "https://files.osf.io/v1/resources/abc/providers/osfstorage/",
      "EID",
      "SID",
    );
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(409);
  });
});

describe("createSession — unknown provider", () => {
  test('returns { success: false, errorText: "Unknown provider" }', async () => {
    const r = await createSession("s3", "tok", "f", "EID", "SID");
    expect(r).toEqual({ success: false, errorText: "Unknown provider" });
  });
});
