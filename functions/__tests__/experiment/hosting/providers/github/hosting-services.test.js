/**
 * Tests for hosting/services.js — focused on the E-7 fix:
 * waitForGithubRepoReady polls the branch ref until ready (instead of
 * a fixed 2-second sleep that fails when GitHub is slow).
 */
import fetchMock from "../../../../helpers/fetch-mock.js";
import { waitForGithubRepoReady } from "../../../../../experiment/hosting/providers/github/index.js";

beforeEach(() => {
  fetchMock.__reset();
});

describe("waitForGithubRepoReady (E-7 fix)", () => {
  test("returns success on first 200 — no extra waiting", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: { name: "main" } }]);
    const r = await waitForGithubRepoReady("tok", "ownerX", "repoY", {
      maxWaitMs: 5000,
      pollIntervalMs: 100,
    });
    expect(r.success).toBe(true);
    expect(r.waitedMs).toBeLessThan(100);
    expect(fetchMock.__getCalls()).toHaveLength(1);
    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe(
      "https://api.github.com/repos/ownerX/repoY/branches/main",
    );
    expect(call.options.method).toBe("GET");
    expect(call.options.headers.Authorization).toBe("Bearer tok");
  });

  test("retries on 404 then succeeds when branch becomes ready", async () => {
    fetchMock.__setMockResponses([
      { status: 404, body: { message: "Branch not found" } },
      { status: 404, body: { message: "Branch not found" } },
      { status: 200, body: { name: "main" } },
    ]);
    const r = await waitForGithubRepoReady("tok", "o", "r", {
      maxWaitMs: 5000,
      pollIntervalMs: 50,
    });
    expect(r.success).toBe(true);
    expect(fetchMock.__getCalls()).toHaveLength(3);
    // Waited at least 2 intervals
    expect(r.waitedMs).toBeGreaterThanOrEqual(100);
  });

  test("returns failure after maxWaitMs when 404 persists", async () => {
    // 20 mock 404s — way more than the test loop will consume
    fetchMock.__setMockResponses(
      Array.from({ length: 20 }, () => ({ status: 404, body: {} })),
    );
    const r = await waitForGithubRepoReady("tok", "o", "r", {
      maxWaitMs: 300,
      pollIntervalMs: 50,
    });
    expect(r.success).toBe(false);
    expect(r.errorText).toMatch(/not ready after 300ms/);
  });

  test("respects custom branch param", async () => {
    fetchMock.__setMockResponses([{ status: 200, body: {} }]);
    await waitForGithubRepoReady("tok", "o", "r", {
      branch: "develop",
      maxWaitMs: 1000,
    });
    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe("https://api.github.com/repos/o/r/branches/develop");
  });
});
