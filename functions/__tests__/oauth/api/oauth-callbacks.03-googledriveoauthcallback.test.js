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

describe("googleDriveOAuthCallback", () => {
  test("OPTIONS preflight returns 204", async () => {
    const res = makeRes();
    await googleDriveOAuthCallback(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
  });

  test("400 when code or uid missing", async () => {
    const res = makeRes();
    await googleDriveOAuthCallback(makeReq({ query: { code: "c" } }), res);
    expect(res.statusCode).toBe(400);
  });

  test("happy path web → POSTs Google token endpoint, stores googleDriveTokens, redirects", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: {
          access_token: "G_AT",
          refresh_token: "G_RT",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "drive.file",
        },
      },
    ]);

    const res = makeRes();
    await googleDriveOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(302);
    expect(res.sentBody).toMatch(/status=success&service=google-drive/);

    const userRef = fs.getRef("users/u1");
    const [body, opts] = userRef.set.mock.calls[0];
    expect(body.googleDriveTokens.access_token).toBe("G_AT");
    expect(body.googleDriveTokens.expires_at).toBeGreaterThan(Date.now());
    expect(opts).toEqual({ merge: true });

    const calls = fetchMock.__getCalls();
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
  });

  test("happy path Electron → JSON", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { access_token: "x", expires_in: 3600 } },
    ]);
    const res = makeRes();
    await googleDriveOAuthCallback(
      makeReq({
        query: { code: "c", state: "u1" },
        headers: { referer: "http://localhost:8888/" },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.message).toMatch(/Google Drive connected/);
  });

  test("token error → web redirect to error", async () => {
    fetchMock.__setMockResponses([
      { status: 400, body: { error_description: "invalid_grant" } },
    ]);
    const res = makeRes();
    await googleDriveOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(302);
    expect(res.sentBody).toMatch(/status=error&service=google-drive/);
  });

  test("emulator mode redirects to localhost:5173 settings on success", async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    fetchMock.__setMockResponses([
      { status: 200, body: { access_token: "x", expires_in: 3600 } },
    ]);
    const res = makeRes();
    await googleDriveOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );
    expect(res.sentBody).toMatch(/http:\/\/localhost:5173\/settings/);
  });
});

// ─── OSF ───────────────────────────────────────────────────────────────────
