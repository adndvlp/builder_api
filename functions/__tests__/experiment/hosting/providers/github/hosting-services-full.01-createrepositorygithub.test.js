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

describe("createRepositoryGithub", () => {
  test("returns error when getGithubUsername fails (non-2xx /user)", async () => {
    fetchMock.__setMockResponses([
      { status: 401, body: { message: "Bad credentials" } },
    ]);
    const r = await createRepositoryGithub("badtok", "repoX");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("Bad credentials");
    expect(r.errorCode).toBe(401);
  });

  test("returns existed=true when repo already exists for that user", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { login: "octo" } }, // /user
      { status: 200, body: { name: "repoX" } }, // /repos/octo/repoX (existing)
    ]);
    const r = await createRepositoryGithub("tok", "repoX");
    expect(r.success).toBe(true);
    expect(r.existed).toBe(true);
    expect(r.owner).toBe("octo");
    expect(r.repoUrl).toBe("https://github.com/octo/repoX");

    const calls = fetchMock.__getCalls();
    expect(calls[1].url).toBe("https://api.github.com/repos/octo/repoX");
  });

  test("creates repo when missing — POSTs /user/repos with auto_init", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { login: "octo" } }, // /user
      { status: 404, body: { message: "Not Found" } }, // /repos/octo/repoX
      {
        status: 201,
        body: {
          name: "repoX",
          html_url: "https://github.com/octo/repoX",
          owner: { login: "octo" },
        },
      },
    ]);
    const r = await createRepositoryGithub("tok", "repoX", true, "desc");
    expect(r.success).toBe(true);
    expect(r.existed).toBe(false);
    expect(r.owner).toBe("octo");

    const createCall = fetchMock.__getCalls()[2];
    expect(createCall.url).toBe("https://api.github.com/user/repos");
    expect(createCall.options.method).toBe("POST");
    const body = JSON.parse(createCall.options.body);
    expect(body).toEqual({
      name: "repoX",
      description: "desc",
      private: true,
      auto_init: true,
    });
  });

  test("propagates create error", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { login: "octo" } },
      { status: 404, body: {} },
      { status: 422, body: { message: "name already exists" } },
    ]);
    const r = await createRepositoryGithub("tok", "repoX");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("name already exists");
    expect(r.errorCode).toBe(422);
  });

  test("catches fetch throw", async () => {
    // Override fetchMock to throw on the FIRST call
    fetchMock.__setMockResponses([
      () => {
        throw new Error("network down");
      },
    ]);
    const r = await createRepositoryGithub("tok", "repoX");
    expect(r.success).toBe(false);
    expect(r.errorText).toBe("network down");
  });
});

// ─── uploadFileGithub ──────────────────────────────────────────────────────
