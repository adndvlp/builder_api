/**
 * Tests for storage.js::listSessions.
 * St-4 (Dropbox/Drive/OSF pagination) and St-5 (strict `${EID}_<noUnderscore>.csv`
 * matcher rejecting sibling-experiment leaks) are fixed; tests assert the new
 * behavior. T-14 OSF componentId contract still pinned.
 */
import fetchMock from "../../../helpers/fetch-mock.js";
import { listSessions } from "../../../../experiment/sessions/storage.js";

beforeEach(() => {
  fetchMock.__reset();
});

describe("listSessions — googledrive", () => {
  test("St-5 FIX: strict matcher rejects sibling experiments with shared prefix", async () => {
    // experimentIDs "foo" and "foo_bar" coexist. Listing for "foo" must NOT
    // pull in "foo_bar_session.csv" — the sessionId portion is required to
    // contain no `_` (sessionIds are UUID-like / `_generateSessionName`-safe).
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          files: [
            { id: "1", name: "foo_session1.csv", createdTime: "2025-01-01" },
            { id: "2", name: "foo_bar_session.csv", createdTime: "2025-01-02" },
            { id: "3", name: "foo_session2.csv", createdTime: "2025-01-03" },
          ],
        },
      },
    ]);
    const r = await listSessions("googledrive", "tok", "folder", "foo");

    expect(r.success).toBe(true);
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["session2", "session1"]);
  });

  test("returns sorted by createdAt desc", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          files: [
            { id: "a", name: "EID_old.csv", createdTime: "2025-01-01" },
            { id: "b", name: "EID_new.csv", createdTime: "2025-01-05" },
          ],
        },
      },
    ]);
    const r = await listSessions("googledrive", "tok", "folder", "EID");
    expect(r.sessions[0].sessionId).toBe("new");
    expect(r.sessions[1].sessionId).toBe("old");
  });

  test("St-4 FIX: follows nextPageToken until exhausted", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          files: [{ id: "a", name: "EID_a.csv", createdTime: "2025-01-01" }],
          nextPageToken: "p2",
        },
      },
      {
        status: 200,
        body: {
          files: [{ id: "b", name: "EID_b.csv", createdTime: "2025-01-02" }],
        },
      },
    ]);
    const r = await listSessions("googledrive", "tok", "folder", "EID");
    expect(r.success).toBe(true);
    expect(r.sessions.map((s) => s.sessionId).sort()).toEqual(["a", "b"]);
    expect(fetchMock.__getCalls()).toHaveLength(2);
    expect(fetchMock.__getCalls()[1].url).toContain("pageToken=p2");
  });
});

describe("listSessions — dropbox", () => {
  test("St-5 FIX: rejects sibling-prefix files and non-session entries", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          entries: [
            { ".tag": "file", name: "EID_s1.csv", server_modified: "2025-01-01", path_display: "/p/EID_s1.csv" },
            { ".tag": "folder", name: "EID_misc" },
            { ".tag": "file", name: "OTHER_s1.csv", server_modified: "2025-01-02", path_display: "/p/x" },
            { ".tag": "file", name: "EID_s2.txt", server_modified: "2025-01-03", path_display: "/p/x" },
            { ".tag": "file", name: "EID_extra_s.csv", server_modified: "2025-01-04", path_display: "/p/x" },
          ],
        },
      },
    ]);
    const r = await listSessions("dropbox", "tok", "/p", "EID");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["s1"]);
    expect(fetchMock.__getCalls()).toHaveLength(1);
  });

  test("St-4 FIX: paginates via /list_folder/continue until has_more=false", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          entries: [{ ".tag": "file", name: "EID_a.csv", server_modified: "2025-01-01", path_display: "/p/a" }],
          cursor: "c1",
          has_more: true,
        },
      },
      {
        status: 200,
        body: {
          entries: [{ ".tag": "file", name: "EID_b.csv", server_modified: "2025-01-02", path_display: "/p/b" }],
          cursor: "c2",
          has_more: false,
        },
      },
    ]);
    const r = await listSessions("dropbox", "tok", "/p", "EID");
    expect(r.success).toBe(true);
    expect(r.sessions.map((s) => s.sessionId).sort()).toEqual(["a", "b"]);

    const calls = fetchMock.__getCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(
      "https://api.dropboxapi.com/2/files/list_folder/continue",
    );
    expect(JSON.parse(calls[1].options.body)).toEqual({ cursor: "c1" });
  });
});

describe("listSessions — osf", () => {
  test("treats folderIdentifier as componentId (T-14: handler.js passes uploadLink instead)", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          data: [{ attributes: { name: "osfstorage" }, relationships: { files: { links: { related: { href: "https://api.osf/files-link" } } } } }],
        },
      },
      {
        status: 200,
        body: {
          data: [
            {
              id: "f1",
              attributes: { kind: "file", name: "EID_s1.csv", date_created: "2025-01-01", date_modified: "2025-01-02" },
            },
          ],
        },
      },
    ]);
    const r = await listSessions("osf", "tok", "abc123", "EID");
    expect(r.success).toBe(true);
    // Verify that the FIRST fetched URL is built from the componentId — confirming
    // the contract: this function expects a componentId, not an uploadLink.
    expect(fetchMock.__getCalls()[0].url).toBe(
      "https://api.osf.io/v2/nodes/abc123/files/",
    );
  });
});
