import { jest } from "@jest/globals";
import { makeReq, makeRes } from "../helpers/firestore-mock.js";

const mockVerifyIdToken = jest.fn();

jest.unstable_mockModule("firebase-admin/auth", () => ({
  getAuth: jest.fn(() => ({ verifyIdToken: mockVerifyIdToken })),
}));
jest.unstable_mockModule("../../app.js", () => ({ app: {} }));

const { verifyFirebaseAuth, requireAuth } = await import("../../utils/auth.js");
const { createOAuthState, validateOAuthState } = await import(
  "../../oauth/state-service.js"
);
const { validateRedirectUri } = await import("../../oauth/utils/redirect-allowlist.js");

const OLD_ENV = { ...process.env };

beforeEach(() => {
  mockVerifyIdToken.mockReset();
  process.env = { ...OLD_ENV };
  delete process.env.OAUTH_STATE_SECRET;
  delete process.env.FUNCTIONS_EMULATOR;
  delete process.env.FIREBASE_APP_BASE_URL;
  delete process.env.OSF_OAUTH_CALLBACK_URL;
  jest.restoreAllMocks();
});

afterAll(() => {
  process.env = OLD_ENV;
});

describe("utils/auth", () => {
  test("verifyFirebaseAuth rejects missing or malformed Bearer headers", async () => {
    await expect(verifyFirebaseAuth(makeReq())).resolves.toMatchObject({
      ok: false,
      status: 401,
    });

    await expect(
      verifyFirebaseAuth(makeReq({ headers: { authorization: "Basic abc" } })),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  test("verifyFirebaseAuth returns decoded uid for a valid token", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: "u1" });

    await expect(
      verifyFirebaseAuth(
        makeReq({
          body: { uid: "u1" },
          headers: { authorization: "Bearer token-123" },
        }),
      ),
    ).resolves.toEqual({ ok: true, uid: "u1" });

    expect(mockVerifyIdToken).toHaveBeenCalledWith("token-123");
  });

  test("verifyFirebaseAuth accepts Authorization casing and optional uid mismatch check", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: "u1" });

    await expect(
      verifyFirebaseAuth(
        makeReq({
          query: { uid: "other" },
          headers: { Authorization: "Bearer token-123" },
        }),
        { requireMatchingUid: false },
      ),
    ).resolves.toEqual({ ok: true, uid: "u1" });
  });

  test("verifyFirebaseAuth rejects invalid tokens and uid mismatches", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockVerifyIdToken.mockRejectedValueOnce(new Error("bad token"));

    await expect(
      verifyFirebaseAuth(makeReq({ headers: { authorization: "Bearer bad" } })),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      message: "Invalid or expired Firebase ID token",
    });
    expect(warnSpy).toHaveBeenCalled();

    mockVerifyIdToken.mockResolvedValueOnce({ uid: "u1" });
    await expect(
      verifyFirebaseAuth(
        makeReq({
          body: { uid: "u2" },
          headers: { authorization: "Bearer token-123" },
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
    });
  });

  test("requireAuth writes the error response or returns the uid", async () => {
    const deniedRes = makeRes();
    await expect(requireAuth(makeReq(), deniedRes)).resolves.toBeNull();
    expect(deniedRes.status).toHaveBeenCalledWith(401);
    expect(deniedRes.jsonBody.success).toBe(false);

    mockVerifyIdToken.mockResolvedValueOnce({ uid: "u1" });
    const okRes = makeRes();
    await expect(
      requireAuth(
        makeReq({ headers: { authorization: "Bearer token-123" } }),
        okRes,
      ),
    ).resolves.toBe("u1");
    expect(okRes.status).not.toHaveBeenCalled();
  });
});

describe("utils/oauth-state", () => {
  test("round-trips a signed state for the expected provider", () => {
    process.env.OAUTH_STATE_SECRET = "test-secret";
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const state = createOAuthState("u1", "github");

    expect(typeof state).toBe("string");
    expect(validateOAuthState(state, "github")).toEqual({ ok: true, uid: "u1" });
  });

  test("requires uid, provider and configured secret outside the emulator", () => {
    expect(() => createOAuthState("", "github")).toThrow(/uid required/);
    expect(() => createOAuthState("u1", "")).toThrow(/provider required/);
    expect(() => createOAuthState("u1", "github")).toThrow(
      /OAUTH_STATE_SECRET/,
    );
  });

  test("uses the emulator fallback secret only when FUNCTIONS_EMULATOR=true", () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const state = createOAuthState("u1", "dropbox");

    expect(validateOAuthState(state, "dropbox")).toEqual({
      ok: true,
      uid: "u1",
    });
  });

  test("rejects missing, malformed, incomplete, provider-mismatched and expired state", () => {
    process.env.OAUTH_STATE_SECRET = "test-secret";
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const state = createOAuthState("u1", "github");

    expect(validateOAuthState("", "github")).toEqual({
      ok: false,
      reason: "missing state",
    });
    expect(validateOAuthState("not-json", "github")).toEqual({
      ok: false,
      reason: "state not base64url JSON",
    });
    expect(
      validateOAuthState(
        Buffer.from(JSON.stringify({ uid: "u1" })).toString("base64url"),
        "github",
      ),
    ).toEqual({ ok: false, reason: "state payload incomplete" });
    expect(validateOAuthState(state, "dropbox")).toEqual({
      ok: false,
      reason: "provider mismatch",
    });

    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000 + 600_001);
    expect(validateOAuthState(state, "github")).toEqual({
      ok: false,
      reason: "state expired",
    });
  });

  test("rejects state payloads with a tampered HMAC", () => {
    process.env.OAUTH_STATE_SECRET = "test-secret";
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const state = createOAuthState("u1", "github");
    const payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    payload.uid = "attacker";
    const tampered = Buffer.from(JSON.stringify(payload)).toString("base64url");

    expect(validateOAuthState(tampered, "github")).toEqual({
      ok: false,
      reason: "invalid HMAC",
    });
  });
});

describe("utils/redirect-allowlist", () => {
  test("allows local, default production and default Cloud Function callback URLs", () => {
    expect(validateRedirectUri("http://localhost:8888/settings")).toBe(
      "http://localhost:8888/settings",
    );
    expect(validateRedirectUri("https://test-e4cf9.firebaseapp.com/settings")).toBe(
      "https://test-e4cf9.firebaseapp.com/settings",
    );
    expect(
      validateRedirectUri(
        "https://us-central1-test-e4cf9.cloudfunctions.net/osfOAuthCallback",
      ),
    ).toBe("https://us-central1-test-e4cf9.cloudfunctions.net/osfOAuthCallback");
  });

  test("allows env-configured app and OSF callback hosts", () => {
    process.env.FIREBASE_APP_BASE_URL = "https://builder.example.com";
    process.env.OSF_OAUTH_CALLBACK_URL =
      "https://callbacks.example.com/osfOAuthCallback";

    expect(validateRedirectUri("https://builder.example.com/settings")).toBe(
      "https://builder.example.com/settings",
    );
    expect(validateRedirectUri("https://callbacks.example.com/osfOAuthCallback")).toBe(
      "https://callbacks.example.com/osfOAuthCallback",
    );
    expect(
      validateRedirectUri("https://us-central1-builder.cloudfunctions.net/cb"),
    ).toBe("https://us-central1-builder.cloudfunctions.net/cb");
  });

  test("rejects missing, malformed, untrusted and non-https production URLs", () => {
    expect(validateRedirectUri()).toBeNull();
    expect(validateRedirectUri("not a url")).toBeNull();
    expect(validateRedirectUri("https://attacker.example.com/callback")).toBeNull();
    expect(validateRedirectUri("http://test-e4cf9.firebaseapp.com/settings")).toBeNull();
    expect(validateRedirectUri("ftp://localhost/settings")).toBeNull();
  });
});
