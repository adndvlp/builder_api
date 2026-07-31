/**
 * Tests for oauth/index.js::getValidToken — central auth dispatcher used by
 * sessions, experiment, participant-files. Mocks Firestore via stateful Map,
 * node-fetch via the existing fetch-mock helper, and refreshOSFToken directly.
 */
import { jest } from "@jest/globals";
import fetchMock from "../helpers/fetch-mock.js";

// ── Stateful Firestore mock ────────────────────────────────────────────────
const userData = new Map(); // uid -> data; absent key = doc doesn't exist
const refsByUid = new Map();

function getUserRef(uid) {
  if (!refsByUid.has(uid)) {
    const ref = {
      get: jest.fn(async () => ({
        exists: userData.has(uid),
        data: () => userData.get(uid),
      })),
      set: jest.fn(async (data, opts) => {
        if (opts?.merge) {
          userData.set(uid, { ...(userData.get(uid) ?? {}), ...data });
        } else {
          userData.set(uid, data);
        }
      }),
      update: jest.fn(async (data) => {
        userData.set(uid, { ...(userData.get(uid) ?? {}), ...data });
      }),
    };
    refsByUid.set(uid, ref);
  }
  return refsByUid.get(uid);
}

const mockDb = {
  collection: jest.fn(() => ({
    doc: jest.fn((uid) => getUserRef(uid)),
  })),
};

const mockRefreshOSFToken = jest.fn();

// ── Mocks must be registered BEFORE dynamic import (ESM) ───────────────────
jest.unstable_mockModule("../../app.js", () => ({ db: mockDb, app: {} }));
jest.unstable_mockModule("../../oauth/api/callbacks/osf.js", () => ({
  refreshOSFToken: mockRefreshOSFToken,
}));

const { getValidToken } = await import("../../oauth/index.js");

beforeEach(() => {
  fetchMock.__reset();
  userData.clear();
  refsByUid.clear();
  mockRefreshOSFToken.mockReset();
});

// ──────────────────────────────────────────────────────────────────────────
describe("getValidToken — user not found", () => {
  test("returns { success: false, error: 'User not found' }", async () => {
    const r = await getValidToken("dropbox", "ghost");
    expect(r).toEqual({ success: false, error: "User not found" });
  });
});

describe("getValidToken — dropbox (and googledrive same path)", () => {
  test("returns existing token when not near expiration", async () => {
    userData.set("u1", {
      dropboxTokens: {
        access_token: "tok-valid",
        refresh_token: "rf",
        expires_at: Date.now() + 10 * 60 * 1000, // 10 min in future
      },
    });
    const r = await getValidToken("dropbox", "u1");
    expect(r.success).toBe(true);
    expect(r.access_token).toBe("tok-valid");
    expect(r.wasRefreshed).toBe(false);
    expect(fetchMock.__getCalls()).toHaveLength(0);
  });

  test("refreshes token when within 5-min expiry buffer + saves new value to Firestore", async () => {
    userData.set("u1", {
      dropboxTokens: {
        access_token: "tok-old",
        refresh_token: "rf-1",
        expires_at: Date.now() + 60 * 1000, // 1 min — within 5-min buffer
      },
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { access_token: "tok-NEW", expires_in: 14400 } },
    ]);
    const r = await getValidToken("dropbox", "u1");
    expect(r.success).toBe(true);
    expect(r.access_token).toBe("tok-NEW");
    expect(r.wasRefreshed).toBe(true);

    // Refresh fetch was to Dropbox token endpoint
    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe("https://api.dropbox.com/oauth2/token");
    expect(call.options.body.toString()).toContain("grant_type=refresh_token");
    expect(call.options.body.toString()).toContain("refresh_token=rf-1");

    // New token persisted to Firestore
    const ref = getUserRef("u1");
    expect(ref.update).toHaveBeenCalledTimes(1);
    const updateArg = ref.update.mock.calls[0][0];
    expect(updateArg.dropboxTokens.access_token).toBe("tok-NEW");
    expect(updateArg.dropboxTokens.refresh_token).toBe("rf-1");
  });

  test("returns failure when user has no provider tokens", async () => {
    userData.set("u1", {}); // user exists but no dropboxTokens
    const r = await getValidToken("dropbox", "u1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/has not connected dropbox/);
  });

  test("returns failure when refresh endpoint returns no access_token", async () => {
    userData.set("u1", {
      dropboxTokens: {
        access_token: "tok-old",
        refresh_token: "bad-rf",
        expires_at: Date.now() - 1000, // already expired
      },
    });
    fetchMock.__setMockResponses([
      { status: 400, body: { error_description: "invalid_grant" } },
    ]);
    const r = await getValidToken("dropbox", "u1");
    expect(r.success).toBe(false);
    expect(r.error).toBe("invalid_grant");
  });
});

describe("getValidToken — osf OAuth path", () => {
  test("returns existing OSF OAuth token when not expired", async () => {
    userData.set("u1", {
      osfTokens: {
        access_token: "osf-oauth-valid",
        refresh_token: "osf-rf",
        expires_at: Date.now() + 10 * 60 * 1000,
      },
    });
    const r = await getValidToken("osf", "u1");
    expect(r.success).toBe(true);
    expect(r.access_token).toBe("osf-oauth-valid");
  });

  test("refreshes OSF OAuth when expired (calls refreshOSFToken)", async () => {
    userData.set("u1", {
      osfTokens: {
        access_token: "osf-old",
        refresh_token: "osf-rf",
        expires_at: Date.now() - 1000,
      },
    });
    mockRefreshOSFToken.mockResolvedValueOnce({
      access_token: "osf-NEW",
      expires_at: Date.now() + 3600 * 1000,
    });

    const r = await getValidToken("osf", "u1");
    expect(r.success).toBe(true);
    expect(r.access_token).toBe("osf-NEW");
    expect(r.wasRefreshed).toBe(true);
    expect(mockRefreshOSFToken).toHaveBeenCalledWith("osf-rf");

    // New tokens persisted
    const ref = getUserRef("u1");
    expect(ref.update).toHaveBeenCalledTimes(1);
    expect(ref.update.mock.calls[0][0].osfTokens.access_token).toBe("osf-NEW");
  });

  test("falls back to manual osfToken when OAuth refresh throws", async () => {
    userData.set("u1", {
      osfTokens: {
        access_token: "osf-stale",
        refresh_token: "osf-rf-bad",
        expires_at: Date.now() - 1000,
      },
      osfToken: "manual-token",
      osfTokenValid: true,
    });
    mockRefreshOSFToken.mockRejectedValueOnce(new Error("refresh blew up"));

    const r = await getValidToken("osf", "u1");
    expect(r.success).toBe(true);
    expect(r.access_token).toBe("manual-token");
    expect(r.wasRefreshed).toBe(false);
  });

  test("uses manual osfToken when no OAuth tokens exist", async () => {
    userData.set("u1", {
      osfToken: "personal-token",
      osfTokenValid: true,
    });
    const r = await getValidToken("osf", "u1");
    expect(r.success).toBe(true);
    expect(r.access_token).toBe("personal-token");
  });

  test("returns failure when neither OAuth nor valid manual token", async () => {
    userData.set("u1", {
      osfToken: "manual",
      osfTokenValid: false, // explicitly invalid
    });
    const r = await getValidToken("osf", "u1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/has not connected OSF or token is invalid/);
  });
});
