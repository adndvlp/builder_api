/**
 * Tests for oauth/callbacks/{dropbox,github,google-drive,osf}.js
 *
 * Shared shape (Dropbox/GitHub/Google Drive):
 *   - OPTIONS preflight → 204
 *   - Missing code or uid → 400 text "Missing code or uid"
 *   - Happy path web → POST token endpoint, save Firestore, res.redirect(settings)
 *   - Happy path Electron (referer localhost:8888) → 200 JSON
 *   - Token error → web redirect to settings?status=error… / Electron 500 JSON
 *
 * OSF differs:
 *   - access_denied → redirect with error
 *   - missing code → 400 JSON
 *   - missing state → 400 JSON
 *   - happy path: fetches token + profile + existing-project filter (reuse or create) + saves tokens
 *   - refreshOSFToken: success and failure
 *   - getOSFAuthorizationUrl: builds URL with all params
 */
import { jest } from "@jest/globals";
import fetchMock from "../../helpers/fetch-mock.js";
import { makeFsMock, makeReq, makeRes } from "../../helpers/firestore-mock.js";

const fs = makeFsMock();

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
}));
jest.unstable_mockModule("../../../app.js", () => ({ db: fs.db, app: {} }));
// T-5: bypass HMAC validation in callback tests. The state-validation
// logic itself has its own unit tests.
jest.unstable_mockModule("../../../oauth/state-service.js", () => ({
  validateOAuthState: jest.fn(() => ({ ok: true, uid: "u1" })),
  createOAuthState: jest.fn(() => "mock-state"),
}));

const { dropboxOAuthCallback } = await import("../../../oauth/api/callbacks/dropbox.js");
const { githubOAuthCallback } = await import("../../../oauth/api/callbacks/github.js");
const { googleDriveOAuthCallback } = await import(
  "../../../oauth/api/callbacks/google-drive.js"
);
const {
  osfOAuthCallback,
  refreshOSFToken,
  getOSFAuthorizationUrl,
} = await import("../../../oauth/api/callbacks/osf.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fetchMock.__reset();
  delete process.env.FUNCTIONS_EMULATOR;
});

// ─── Dropbox ───────────────────────────────────────────────────────────────

describe("osfOAuthCallback", () => {
  test("OPTIONS preflight returns 204", async () => {
    const res = makeRes();
    await osfOAuthCallback(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
  });

  test("error=access_denied → redirects to client with access_denied", async () => {
    const res = makeRes();
    await osfOAuthCallback(
      makeReq({ query: { error: "access_denied" } }),
      res,
    );
    expect(res.statusCode).toBe(302);
    expect(res.sentBody).toMatch(/error=access_denied&provider=osf/);
  });

  test("400 when code missing", async () => {
    const res = makeRes();
    await osfOAuthCallback(makeReq({ query: { state: "u1" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Missing authorization code/);
  });

  test("400 when state missing", async () => {
    const res = makeRes();
    await osfOAuthCallback(makeReq({ query: { code: "c" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Missing state/);
  });

  test("token exchange failure → 400 with errorText", async () => {
    fetchMock.__setMockResponses([
      { status: 400, body: "invalid_grant" },
    ]);
    const res = makeRes();
    await osfOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/Failed to exchange code/);
  });

  test("happy path with existing ExpBuilder project → reuses it (no creation POST)", async () => {
    fetchMock.__setMockResponses([
      // 1. token exchange
      {
        status: 200,
        body: {
          access_token: "AT",
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "RT",
        },
      },
      // 2. profile
      {
        status: 200,
        body: {
          data: { id: "usr1", attributes: { full_name: "Alice" } },
        },
      },
      // 3. list nodes filter (existing project)
      {
        status: 200,
        body: { data: [{ id: "proj-existing", attributes: { title: "ExpBuilder" } }] },
      },
    ]);

    const res = makeRes();
    await osfOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(302);
    expect(res.sentBody).toMatch(/success=true&provider=osf/);

    const userRef = fs.getRef("users/u1");
    const [body, opts] = userRef.set.mock.calls[0];
    expect(body.osfTokens.access_token).toBe("AT");
    expect(body.osfTokens.refresh_token).toBe("RT");
    expect(body.osfUserId).toBe("usr1");
    expect(body.osfUserName).toBe("Alice");
    expect(body.osfTokenValid).toBe(true);
    expect(body.osfProjectId).toBe("proj-existing");
    expect(opts).toEqual({ merge: true });

    // Only 3 fetch calls (no POST to create)
    expect(fetchMock.__getCalls()).toHaveLength(3);
  });

  test("happy path with NO existing project → POSTs to create one", async () => {
    fetchMock.__setMockResponses([
      // token exchange
      { status: 200, body: { access_token: "AT", expires_in: 3600 } },
      // profile
      {
        status: 200,
        body: { data: { id: "usr2", attributes: { full_name: "Bob" } } },
      },
      // list nodes — empty
      { status: 200, body: { data: [] } },
      // create project
      { status: 201, body: { data: { id: "proj-new" } } },
    ]);

    const res = makeRes();
    await osfOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(302);
    const calls = fetchMock.__getCalls();
    expect(calls).toHaveLength(4);
    expect(calls[3].url).toBe("https://api.osf.io/v2/nodes/?region=us");
    expect(calls[3].options.method).toBe("POST");

    const userRef = fs.getRef("users/u1");
    expect(userRef.set.mock.calls[0][0].osfProjectId).toBe("proj-new");
  });

  test("internal error after token exchange → redirects with token_exchange_failed", async () => {
    fetchMock.__setMockResponses([
      // token exchange OK
      { status: 200, body: { access_token: "AT", expires_in: 3600 } },
      // profile throws (simulate via empty/non-ok)
      { status: 500, body: "boom" },
      // list nodes — also 500 to make project fetch noisy (caught internally)
      { status: 500, body: "boom" },
    ]);
    // db.set throws → triggers outer catch
    fs.getRef("users/u1").set.mockRejectedValueOnce(new Error("firestore down"));

    const res = makeRes();
    await osfOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(302);
    expect(res.sentBody).toMatch(/error=token_exchange_failed&provider=osf/);
  });
});

// ─── OSF helpers ───────────────────────────────────────────────────────────
