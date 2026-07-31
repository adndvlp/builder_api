import * as dropbox from "./providers/dropbox/index.js";
import * as googleDrive from "./providers/google-drive/index.js";
import * as osf from "./providers/osf/index.js";

const PARTICIPANT_FILE_PROVIDERS = {
  dropbox,
  googledrive: googleDrive,
  "google-drive": googleDrive,
  osf,
};

export function getParticipantFileProvider(provider) {
  return PARTICIPANT_FILE_PROVIDERS[provider] || null;
}
