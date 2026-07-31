/**
 * Tests for the GitHub helper functions in hosting/services.js:
 *   - createRepositoryGithub (uses internal getGithubUsername)
 *   - uploadFileGithub (sha-aware update vs create)
 *   - enableGithubPages (existing vs newly enabled + 2s wait)
 *   - deleteRepositoryGithub (200/204 success, error)
 *   - getRepositoryInfo (200, non-2xx, throw)
 *
 * (`waitForGithubRepoReady` lives in hosting-services.test.js.)
 *
 * The 2-second `setTimeout` inside `enableGithubPages` is exercised via Jest
 * fake timers so the tests stay sub-second.
 */
import { jest } from "@jest/globals";
import fetchMock from "../../../../helpers/fetch-mock.js";
import {
  createRepositoryGithub,
  uploadFileGithub,
  enableGithubPages,
  deleteRepositoryGithub,
  getRepositoryInfo,
} from "../../../../../experiment/hosting/providers/github/index.js";

const realSetTimeout = global.setTimeout;

beforeEach(() => {
  fetchMock.__reset();
});

afterEach(() => {
  global.setTimeout = realSetTimeout;
});

/**
 * The enableGithubPages flow has a hard-coded `await new Promise(r =>
 * setTimeout(r, 2000))` between "POST /pages" and "GET /pages" to give
 * GitHub time to provision. Replacing setTimeout with an immediate
 * microtask keeps the test sub-second without changing production code.
 */
function skipPagesWait() {
  global.setTimeout = (fn) => {
    Promise.resolve().then(fn);
    return 0;
  };
}

// ─── createRepositoryGithub ────────────────────────────────────────────────

describe("enableGithubPages", () => {
  test("already-enabled path: GET returns 200 → existed=true (no POST, no setTimeout)", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { html_url: "https://o.github.io/r/" } },
    ]);
    const r = await enableGithubPages("tok", "o", "r");
    expect(r.success).toBe(true);
    expect(r.existed).toBe(true);
    expect(r.pagesUrl).toBe("https://o.github.io/r/");
    expect(fetchMock.__getCalls()).toHaveLength(1);
  });

  test("not enabled → POST 201, then post-check GET returns final URL", async () => {
    skipPagesWait();
    fetchMock.__setMockResponses([
      { status: 404, body: {} }, // existence check
      { status: 201, body: {} }, // POST enable
      { status: 200, body: { html_url: "https://o.github.io/r/" } }, // post-create GET
    ]);

    const r = await enableGithubPages("tok", "o", "r");

    expect(r.success).toBe(true);
    expect(r.existed).toBe(false);
    expect(r.pagesUrl).toBe("https://o.github.io/r/");
    expect(fetchMock.__getCalls()).toHaveLength(3);
  });

  test("not enabled → POST 201, but post-check fails → estimated URL fallback", async () => {
    skipPagesWait();
    fetchMock.__setMockResponses([
      { status: 404, body: {} },
      { status: 201, body: {} },
      { status: 500, body: {} }, // post-check fails
    ]);

    const r = await enableGithubPages("tok", "o", "r");

    expect(r.success).toBe(true);
    expect(r.existed).toBe(false);
    expect(r.pagesUrl).toBe("https://o.github.io/r/");
  });

  test("POST enable error propagated", async () => {
    fetchMock.__setMockResponses([
      { status: 404, body: {} },
      { status: 403, body: { message: "Pages disabled for org" } },
    ]);
    const r = await enableGithubPages("tok", "o", "r");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Pages disabled for org");
    expect(r.errorCode).toBe(403);
  });

  test("Ho-5 FIX: 422 'pages site already exists' treated as success, not error", async () => {
    skipPagesWait();
    fetchMock.__setMockResponses([
      { status: 404, body: {} }, // existence check race-lost: someone else created Pages between checks
      { status: 422, body: { message: "A pages site already exists" } },
      { status: 200, body: { html_url: "https://o.github.io/r/" } },
    ]);
    const r = await enableGithubPages("tok", "o", "r");
    expect(r.success).toBe(true);
    expect(r.pagesUrl).toBe("https://o.github.io/r/");
  });

  test("Ho-2 FIX: post-check fails → falls back to estimated URL via bounded poll", async () => {
    fetchMock.__setMockResponses([
      { status: 404, body: {} }, // existence
      { status: 201, body: {} }, // POST enable
      { status: 500, body: {} }, // first poll fails
    ]);
    // maxAttempts=1 ends polling after a single attempt
    const r = await enableGithubPages("tok", "o", "r", "main", "/", {
      maxAttempts: 1,
      pollIntervalMs: 0,
    });
    expect(r.success).toBe(true);
    expect(r.pagesUrl).toBe("https://o.github.io/r/");
  });

  test("respects custom branch/path in POST body", async () => {
    skipPagesWait();
    fetchMock.__setMockResponses([
      { status: 404, body: {} },
      { status: 201, body: {} },
      { status: 200, body: { html_url: "u" } },
    ]);
    await enableGithubPages("tok", "o", "r", "develop", "/docs");

    const postCall = fetchMock.__getCalls()[1];
    const body = JSON.parse(postCall.options.body);
    expect(body.source).toEqual({ branch: "develop", path: "/docs" });
  });
});

// ─── deleteRepositoryGithub ───────────────────────────────────────────────
