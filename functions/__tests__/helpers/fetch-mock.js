/**
 * Default node-fetch mock. Tests import this module and override `__setMockResponses`
 * or `__getCalls` to control behavior + inspect requests.
 *
 * Designed to be replaced per-test. Default returns a 200 with empty JSON.
 */

let mockResponses = [];
let calls = [];

function makeResponse(spec) {
  const status = spec.status ?? 200;
  const ok = status >= 200 && status < 300;
  const bodyText =
    typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body ?? {});
  return {
    ok,
    status,
    statusText: spec.statusText ?? (ok ? "OK" : "Error"),
    json: async () => (typeof spec.body === "string" ? JSON.parse(bodyText) : (spec.body ?? {})),
    text: async () => bodyText,
    headers: new Map(Object.entries(spec.headers ?? {})),
  };
}

async function fetchMock(url, options = {}) {
  calls.push({ url: String(url), options });
  if (mockResponses.length === 0) {
    return makeResponse({ status: 200, body: {} });
  }
  const next = mockResponses.shift();
  if (typeof next === "function") {
    return makeResponse(next(url, options));
  }
  return makeResponse(next);
}

fetchMock.__setMockResponses = (responses) => {
  mockResponses = [...responses];
};
fetchMock.__getCalls = () => [...calls];
fetchMock.__reset = () => {
  mockResponses = [];
  calls = [];
};

export default fetchMock;
