import * as github from "./providers/github/index.js";

const HOSTING_PROVIDERS = {
  github,
};

export function getHostingProvider(provider = "github") {
  return HOSTING_PROVIDERS[provider] || null;
}
