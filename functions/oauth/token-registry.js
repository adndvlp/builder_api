import dropbox from "./providers/dropbox/index.js";
import googleDrive from "./providers/google-drive/index.js";
import osf from "./providers/osf/index.js";

const TOKEN_PROVIDERS = {
  dropbox,
  googledrive: googleDrive,
  "google-drive": googleDrive,
  osf,
};

export function getTokenProvider(provider) {
  return TOKEN_PROVIDERS[provider] || null;
}
