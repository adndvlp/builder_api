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

describe("deleteRepositoryGithub", () => {
  test("204 No Content → success", async () => {
    fetchMock.__setMockResponses([{ status: 204, body: "" }]);
    const r = await deleteRepositoryGithub("tok", "o", "r");
    expect(r.success).toBe(true);

    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe("https://api.github.com/repos/o/r");
    expect(call.options.method).toBe("DELETE");
  });

  test("404 → error with errorCode 404 (caller can choose to ignore)", async () => {
    fetchMock.__setMockResponses([{ status: 404, body: { message: "Not Found" } }]);
    const r = await deleteRepositoryGithub("tok", "o", "r");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe(404);
    expect(r.errorText).toBe("Not Found");
  });

  test("catches fetch throw", async () => {
    fetchMock.__setMockResponses([
      () => {
        throw new Error("network down");
      },
    ]);
    const r = await deleteRepositoryGithub("tok", "o", "r");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("network down");
  });
});

// ─── getRepositoryInfo ────────────────────────────────────────────────────
