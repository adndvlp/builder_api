/**
 * Tests for oauth/github-token.js — getGithubToken (Firestore lookup) and
 * getGithubOwner (HTTP fetch to /user). Both functions are used everywhere
 * publishExperiment / deleteExperiment hit GitHub.
 */
import { jest } from "@jest/globals";
import fetchMock from "../helpers/fetch-mock.js";
import { makeFsMock } from "../helpers/firestore-mock.js";

const fs = makeFsMock();

jest.unstable_mockModule("../../app.js", () => ({ db: fs.db }));

const { getGithubToken, getGithubOwner } = await import(
  "../../oauth/providers/github/token.js"
);

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fetchMock.__reset();
});

// ─── getGithubToken ────────────────────────────────────────────────────────
describe("getGithubToken", () => {
  test("returns access_token when stored under users/<uid>.githubTokens", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ githubTokens: { access_token: "ghp_abc" } }),
    });
    const r = await getGithubToken("u1");
    expect(r).toEqual({ success: true, access_token: "ghp_abc" });
  });

  test("returns 'User not found' when user doc absent", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({ exists: false });
    const r = await getGithubToken("u1");
    expect(r).toEqual({ success: false, error: "User not found" });
  });

  test("returns 'No GitHub token found' when user has no githubTokens field", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ email: "x@y" }),
    });
    const r = await getGithubToken("u1");
    expect(r).toEqual({
      success: false,
      error: "No GitHub token found for user",
    });
  });

  test("returns 'No GitHub token found' when githubTokens exists but access_token missing", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ githubTokens: { scope: "repo" } }),
    });
    const r = await getGithubToken("u1");
    expect(r.success).toBe(false);
    expect(r.error).toBe("No GitHub token found for user");
  });

  test("catches Firestore errors and returns the message", async () => {
    fs.getRef("users/u1").get.mockRejectedValueOnce(new Error("rules denied"));
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await getGithubToken("u1");
    expect(r).toEqual({ success: false, error: "rules denied" });
    errSpy.mockRestore();
  });
});

// ─── getGithubOwner ────────────────────────────────────────────────────────
describe("getGithubOwner", () => {
  test("returns userData.login on 200", async () => {
    fetchMock.__setMockResponses([
      { status: 200, body: { login: "octocat", id: 1 } },
    ]);
    const owner = await getGithubOwner("tok");
    expect(owner).toBe("octocat");

    const call = fetchMock.__getCalls()[0];
    expect(call.url).toBe("https://api.github.com/user");
    expect(call.options.method).toBe("GET");
    expect(call.options.headers.Authorization).toBe("Bearer tok");
    expect(call.options.headers.Accept).toBe("application/vnd.github.v3+json");
  });

  test("throws with API message on non-2xx", async () => {
    fetchMock.__setMockResponses([
      { status: 401, body: { message: "Bad credentials" } },
    ]);
    await expect(getGithubOwner("badtok")).rejects.toThrow("Bad credentials");
  });

  test("throws fallback when API body has no message field", async () => {
    fetchMock.__setMockResponses([{ status: 500, body: {} }]);
    await expect(getGithubOwner("tok")).rejects.toThrow(
      "Error getting GitHub user information",
    );
  });
});
