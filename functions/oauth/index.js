export { refreshAccessToken } from "./refresh.js";
export { getValidToken } from "./token-service.js";
export { saveTokens } from "./save-tokens.js";
export { getTokenProvider } from "./token-registry.js";

import { getValidToken } from "./token-service.js";

export default function getValidDropboxToken(uid) {
  return getValidToken("dropbox", uid);
}

export function getValidGoogleDriveToken(uid) {
  return getValidToken("googledrive", uid);
}
