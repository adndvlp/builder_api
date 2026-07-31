import nodeFetch from "node-fetch";

/**
 * node-fetch wrapper that applies a default timeout via AbortSignal.
 *
 * Cloud Functions v2 has a hard 540s deadline; a slow external API (Drive,
 * Dropbox, OSF, GitHub) without an explicit timeout will pin the function
 * for the full deadline, burning CPU-seconds for nothing and blocking the
 * caller. 30s is generous for any single HTTP call to a healthy backend
 * and short enough that a stuck upstream surfaces as an error long before
 * the function billing window closes.
 *
 * Callers can override per-call by passing an explicit `signal` (their
 * signal wins) or `timeoutMs` in options.
 *
 * @param {string} url
 * @param {Object} [options] - same shape as node-fetch options
 * @param {number} [options.timeoutMs=30000]
 * @returns {Promise<Response>}
 */
export default async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs, signal: callerSignal, ...rest } = options;

  // Caller-supplied signal wins (preserve their cancellation semantics).
  if (callerSignal) {
    return nodeFetch(url, { ...rest, signal: callerSignal });
  }

  const effectiveTimeout = Number.isFinite(timeoutMs) ? timeoutMs : 30000;
  const signal = AbortSignal.timeout(effectiveTimeout);

  try {
    return await nodeFetch(url, { ...rest, signal });
  } catch (err) {
    // AbortSignal.timeout fires `TimeoutError` / `AbortError` — normalize
    // the message so callers can detect timeouts uniformly.
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      const wrapped = new Error(
        `Request to ${url} timed out after ${effectiveTimeout}ms`,
      );
      wrapped.code = "ETIMEDOUT";
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  }
}
