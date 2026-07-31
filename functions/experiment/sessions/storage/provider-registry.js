import * as dropbox from "./providers/dropbox/index.js";
import * as googleDrive from "./providers/google-drive/index.js";
import * as osf from "./providers/osf/index.js";

const SESSION_STORAGE_PROVIDERS = {
  dropbox,
  googledrive: googleDrive,
  "google-drive": googleDrive,
  osf,
};

export function getSessionStorageProvider(provider) {
  return SESSION_STORAGE_PROVIDERS[provider] || null;
}
