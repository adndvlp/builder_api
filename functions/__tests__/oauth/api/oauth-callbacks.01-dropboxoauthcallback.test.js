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

describe("dropboxOAuthCallback", () => {
  test("OPTIONS preflight returns 204", async () => {
    const res = makeRes();
    await dropboxOAuthCallback(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
  });

  test("400 when code missing", async () => {
    const res = makeRes();
    await dropboxOAuthCallback(makeReq({ query: { state: "u1" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.sentBody).toBe("Missing code or state");
  });

  test("400 when uid missing (state)", async () => {
    const res = makeRes();
    await dropboxOAuthCallback(makeReq({ query: { code: "c" } }), res);
    expect(res.statusCode).toBe(400);
  });

  test("happy path web → POSTs token endpoint, saves Firestore, redirects to web settings", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          access_token: "AT",
          refresh_token: "RT",
          token_type: "bearer",
          expires_in: 14400,
          scope: "files",
          uid: "duid",
          account_id: "acc1",
        },
      },
    ]);

    const res = makeRes();
    await dropboxOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(302);
    expect(res.sentBody).toMatch(/settings\?status=success&service=dropbox/);

    const userRef = fs.getRef("users/u1");
    expect(userRef.set).toHaveBeenCalledTimes(1);
    const [body, opts] = userRef.set.mock.calls[0];
    expect(body.dropboxTokens.access_token).toBe("AT");
    expect(body.dropboxTokens.refresh_token).toBe("RT");
    expect(body.dropboxTokens.expires_at).toBeGreaterThan(Date.now());
    expect(opts).toEqual({ merge: true });

    // Verify the POST hit Dropbox token endpoint
    const calls = fetchMock.__getCalls();
    expect(calls[0].url).toBe("https://api.dropbox.com/oauth2/token");
    expect(calls[0].options.method).toBe("POST");
  });

  test("happy path Electron → 200 JSON, no redirect", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { access_token: "AT", expires_in: 14400 } },
    ]);
    const res = makeRes();
    await dropboxOAuthCallback(
      makeReq({
        query: { code: "c", state: "u1" },
        headers: { referer: "http://localhost:8888/settings" },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.success).toBe(true);
    expect(res.jsonBody.message).toMatch(/Dropbox connected/);
  });

  test("token error (no access_token) on web → redirects to error", async () => {
    fetchMock.__setMockResponses([
      { status: 400, body: { error_description: "bad code" } },
    ]);
    const res = makeRes();
    await dropboxOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(302);
    expect(res.sentBody).toMatch(/status=error&service=dropbox/);
    expect(res.sentBody).toMatch(/bad%20code/);
  });

  test("token error on Electron → 500 JSON", async () => {
    fetchMock.__setMockResponses([
      { status: 400, body: { error_description: "bad code" } },
    ]);
    const res = makeRes();
    await dropboxOAuthCallback(
      makeReq({
        query: { code: "c", state: "u1" },
        headers: { referer: "http://localhost:8888/" },
      }),
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody.success).toBe(false);
    expect(res.jsonBody.error).toBe("bad code");
  });
});

// ─── GitHub ────────────────────────────────────────────────────────────────
