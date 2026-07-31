import { jest } from "@jest/globals";

const mockNodeFetch = jest.fn();

jest.unstable_mockModule("node-fetch", () => ({
  default: mockNodeFetch,
}));

const fetchWithTimeout = (await import("../../utils/fetch-with-timeout.js")).default;

beforeEach(() => {
  mockNodeFetch.mockReset();
});

describe("fetchWithTimeout", () => {
  test("preserves a caller-supplied AbortSignal and strips timeoutMs", async () => {
    const signal = AbortSignal.abort();
    const response = { ok: true };
    mockNodeFetch.mockResolvedValueOnce(response);

    await expect(
      fetchWithTimeout("https://example.test", {
        method: "POST",
        timeoutMs: 10,
        signal,
      }),
    ).resolves.toBe(response);

    expect(mockNodeFetch).toHaveBeenCalledWith("https://example.test", {
      method: "POST",
      signal,
    });
  });

  test("adds an AbortSignal.timeout signal with default or explicit timeout", async () => {
    const response = { ok: true };
    mockNodeFetch.mockResolvedValue(response);

    await expect(fetchWithTimeout("https://default.test")).resolves.toBe(response);
    await expect(
      fetchWithTimeout("https://explicit.test", { timeoutMs: 1234 }),
    ).resolves.toBe(response);

    expect(mockNodeFetch).toHaveBeenNthCalledWith(
      1,
      "https://default.test",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockNodeFetch).toHaveBeenNthCalledWith(
      2,
      "https://explicit.test",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("normalizes AbortError and TimeoutError into ETIMEDOUT", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    mockNodeFetch.mockRejectedValueOnce(abort);

    await expect(fetchWithTimeout("https://slow.test", { timeoutMs: 5 })).rejects.toMatchObject({
      message: "Request to https://slow.test timed out after 5ms",
      code: "ETIMEDOUT",
      cause: abort,
    });

    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    mockNodeFetch.mockRejectedValueOnce(timeout);

    await expect(fetchWithTimeout("https://slower.test")).rejects.toMatchObject({
      message: "Request to https://slower.test timed out after 30000ms",
      code: "ETIMEDOUT",
      cause: timeout,
    });
  });

  test("rethrows non-timeout fetch failures unchanged", async () => {
    const upstream = new Error("dns failed");
    mockNodeFetch.mockRejectedValueOnce(upstream);

    await expect(fetchWithTimeout("https://broken.test")).rejects.toBe(upstream);
  });
});
