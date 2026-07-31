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

describe("githubOAuthCallback", () => {
  test("OPTIONS preflight returns 204", async () => {
    const res = makeRes();
    await githubOAuthCallback(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
  });

  test("400 when code or uid missing", async () => {
    const res = makeRes();
    await githubOAuthCallback(makeReq({ query: {} }), res);
    expect(res.statusCode).toBe(400);
  });

  test("happy path web → POSTs GH token endpoint, stores githubTokens, redirects", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: { access_token: "GH_AT", token_type: "bearer", scope: "repo" },
      },
    ]);

    const res = makeRes();
    await githubOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );

    expect(res.statusCode).toBe(302);
    expect(res.sentBody).toMatch(/status=success&service=github/);

    const userRef = fs.getRef("users/u1");
    expect(userRef.set).toHaveBeenCalledWith(
      { githubTokens: expect.objectContaining({ access_token: "GH_AT" }) },
      { merge: true },
    );

    const calls = fetchMock.__getCalls();
    expect(calls[0].url).toBe("https://github.com/login/oauth/access_token");
  });

  test("happy path Electron → JSON success", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { access_token: "x" } },
    ]);
    const res = makeRes();
    await githubOAuthCallback(
      makeReq({
        query: { code: "c", state: "u1" },
        headers: { referer: "http://localhost:8888/" },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody.success).toBe(true);
  });

  test("token error → web redirect with error", async () => {
    fetchMock.__setMockResponses([
      { status: 400, body: { error: "bad_verification_code" } },
    ]);
    const res = makeRes();
    await githubOAuthCallback(
      makeReq({ query: { code: "c", state: "u1" } }),
      res,
    );
    expect(res.statusCode).toBe(302);
    expect(res.sentBody).toMatch(/status=error&service=github/);
  });
});

// ─── Google Drive ──────────────────────────────────────────────────────────
