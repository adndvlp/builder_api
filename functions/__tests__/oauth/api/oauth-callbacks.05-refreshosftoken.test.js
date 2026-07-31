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

describe("refreshOSFToken", () => {
  test("returns fresh tokens on success", async () => {
    fetchMock.__setMockResponses([
      {
        status: 200,
        body: { access_token: "AT2", token_type: "bearer", expires_in: 3600 },
      },
    ]);
    const r = await refreshOSFToken("RT");
    expect(r.access_token).toBe("AT2");
    expect(r.token_type).toBe("bearer");
    expect(r.expires_at).toBeGreaterThan(Date.now());

    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe("https://accounts.osf.io/oauth2/token");
    expect(call.options.body.toString()).toMatch(/grant_type=refresh_token/);
  });

  test("throws when token refresh fails", async () => {
    fetchMock.__setMockResponses([{ status: 400, body: "invalid_grant" }]);
    await expect(refreshOSFToken("RT")).rejects.toThrow(
      "Failed to refresh OSF token",
    );
  });
});
