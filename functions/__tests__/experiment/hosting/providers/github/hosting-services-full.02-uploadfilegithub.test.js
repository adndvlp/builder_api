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

describe("uploadFileGithub", () => {
  test("creates file when GET 404 (no SHA in PUT body)", async () => {
    fetchMock.__setMockResponses([
      { status: 404, body: { message: "Not Found" } }, // existence check
      {
        status: 201,
        body: {
          content: { html_url: "https://github.com/o/r/blob/main/x.html" },
          commit: { sha: "abcd1234" },
        },
      },
    ]);
    const r = await uploadFileGithub("tok", "o", "r", "x.html", "<html/>");
    expect(r.success).toBe(true);
    expect(r.commit).toBe("abcd1234");

    const putCall = fetchMock.__getCalls()[1];
    expect(putCall.options.method).toBe("PUT");
    const body = JSON.parse(putCall.options.body);
    expect(body).not.toHaveProperty("sha");
    expect(body.content).toBe(Buffer.from("<html/>").toString("base64"));
    expect(body.branch).toBe("main");
  });

  test("updates file when GET 200 (passes SHA)", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { sha: "oldsha" } }, // existence check
      {
        status: 200,
        body: {
          content: { html_url: "https://github.com/o/r/blob/main/x.html" },
          commit: { sha: "newsha" },
        },
      },
    ]);
    await uploadFileGithub("tok", "o", "r", "x.html", "new", "Update", "main");
    const putCall = fetchMock.__getCalls()[1];
    const body = JSON.parse(putCall.options.body);
    expect(body.sha).toBe("oldsha");
    expect(body.message).toBe("Update");
  });

  test("returns error on upload failure", async () => {
    fetchMock.__setMockResponses([
      { status: 404, body: {} },
      { status: 422, body: { message: "Invalid request" } },
    ]);
    const r = await uploadFileGithub("tok", "o", "r", "x.html", "x");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Invalid request");
    expect(r.errorCode).toBe(422);
  });
});

// ─── enableGithubPages ────────────────────────────────────────────────────
