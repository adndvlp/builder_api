/**
 * Fast wins for oauth/index.js — covers:
 *   - refreshAccessToken: unknown provider, fetch throws, missing access_token,
 *     missing error_description fallback (tested indirectly via getValidToken)
 *   - getValidToken: outer catch when Firestore rejects
 *   - saveTokens: dropbox + googledrive token_type variance, error path
 *   - Default-export wrappers: getValidDropboxToken + getValidGoogleDriveToken
 */
import { jest } from "@jest/globals";
import fetchMock from "../helpers/fetch-mock.js";

const userData = new Map();
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

jest.unstable_mockModule("../../app.js", () => ({ db: mockDb, app: {} }));
jest.unstable_mockModule("../../oauth/api/callbacks/osf.js", () => ({
  refreshOSFToken: mockRefreshOSFToken,
}));

const oauthModule = await import("../../oauth/index.js");
const {
  getValidToken,
  saveTokens,
  getValidGoogleDriveToken,
} = oauthModule;
const getValidDropboxToken = oauthModule.default;

beforeEach(() => {
  fetchMock.__reset();
  userData.clear();
  refsByUid.clear();
  mockRefreshOSFToken.mockReset();
});

// ─── refreshAccessToken (covered via getValidToken) ──────────────────────
describe("refreshAccessToken (via getValidToken)", () => {
  test("unknown provider returns 'Unknown provider: X'", async () => {
    // getValidToken("foo", uid): goes to non-osf branch; tokensFieldName is
    // computed as "googleDriveTokens" (provider !== "dropbox"). If tokens exist
    // & expired, refreshAccessToken("foo", ...) sees no config → returns error.
    userData.set("u1", {
      googleDriveTokens: {
        access_token: "old",
        refresh_token: "rf",
        expires_at: Date.now() - 1000, // expired
      },
    });
    const r = await getValidToken("foo", "u1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown provider: foo/);
  });

  test("fetch throw during refresh → outer catch returns error", async () => {
    userData.set("u1", {
      dropboxTokens: {
        access_token: "old",
        refresh_token: "rf",
        expires_at: Date.now() - 1000,
      },
    });
    fetchMock.__setMockResponses([
      () => {
        throw new Error("network down");
      },
    ]);
    const r = await getValidToken("dropbox", "u1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/network down/);
  });

  test("refresh response without error_description falls back to default message", async () => {
    userData.set("u1", {
      dropboxTokens: {
        access_token: "old",
        refresh_token: "rf",
        expires_at: Date.now() - 1000,
      },
    });
    fetchMock.__setMockResponses([{ status: 400, body: {} }]);
    const r = await getValidToken("dropbox", "u1");
    expect(r.success).toBe(false);
    expect(r.error).toBe("No access token returned");
  });
});

// ─── getValidToken outer catch ───────────────────────────────────────────
describe("getValidToken — outer catch", () => {
  test("returns failure when userRef.get throws", async () => {
    // Pre-create the ref then make .get reject
    const ref = getUserRef("u1");
    ref.get.mockRejectedValueOnce(new Error("firestore down"));
    const r = await getValidToken("dropbox", "u1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/firestore down/);
  });
});

// ─── saveTokens ──────────────────────────────────────────────────────────
describe("saveTokens", () => {
  test("dropbox: writes dropboxTokens field with token_type='bearer'", async () => {
    const r = await saveTokens("dropbox", "u1", "acc", "rf", 3600);
    expect(r.success).toBe(true);
    const ref = getUserRef("u1");
    expect(ref.set).toHaveBeenCalledTimes(1);
    const [body, opts] = ref.set.mock.calls[0];
    expect(opts).toEqual({ merge: true });
    expect(body.dropboxTokens.access_token).toBe("acc");
    expect(body.dropboxTokens.refresh_token).toBe("rf");
    expect(body.dropboxTokens.expires_in).toBe(3600);
    expect(body.dropboxTokens.token_type).toBe("bearer");
    // expires_at = Date.now() + expires_in*1000
    expect(typeof body.dropboxTokens.expires_at).toBe("number");
    expect(body.dropboxTokens.expires_at).toBeGreaterThan(Date.now() + 3500 * 1000);
  });

  test("O-7 FIX: googledrive token_type normalized to lower-case 'bearer'", async () => {
    const r = await saveTokens("googledrive", "u1", "g-acc", "g-rf", 7200);
    expect(r.success).toBe(true);
    const ref = getUserRef("u1");
    const [body] = ref.set.mock.calls[0];
    expect(body.googleDriveTokens.token_type).toBe("bearer");
    expect(body.googleDriveTokens.access_token).toBe("g-acc");
    expect(body.googleDriveTokens.expires_in).toBe(7200);
  });

  test("returns failure when Firestore set rejects", async () => {
    const ref = getUserRef("u1");
    ref.set.mockRejectedValueOnce(new Error("firestore unreachable"));
    const r = await saveTokens("dropbox", "u1", "acc", "rf", 3600);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/firestore unreachable/);
  });
});

// ─── Default-export wrappers ─────────────────────────────────────────────
describe("default-export wrappers", () => {
  test("getValidDropboxToken delegates to getValidToken('dropbox', uid)", async () => {
    const r = await getValidDropboxToken("ghost");
    expect(r).toEqual({ success: false, error: "User not found" });
  });

  test("getValidGoogleDriveToken delegates to getValidToken('googledrive', uid)", async () => {
    const r = await getValidGoogleDriveToken("ghost");
    expect(r).toEqual({ success: false, error: "User not found" });
  });

  test("getValidGoogleDriveToken refreshes via googledrive endpoint when expired", async () => {
    userData.set("u1", {
      googleDriveTokens: {
        access_token: "old",
        refresh_token: "g-rf",
        expires_at: Date.now() - 1000,
      },
    });
    fetchMock.__setMockResponses([
      { status: 200, body: { access_token: "g-NEW", expires_in: 3600 } },
    ]);
    const r = await getValidGoogleDriveToken("u1");
    expect(r.success).toBe(true);
    expect(r.access_token).toBe("g-NEW");
    // refresh URL was the Google one
    expect(fetchMock.__getCalls()[0].url).toBe(
      "https://oauth2.googleapis.com/token",
    );
  });
});
