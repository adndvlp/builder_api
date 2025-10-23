import { apiDataHandler } from "./api-handler.js";
import { finalizeDisconnectedSessionsDropbox } from "./api-data-dropbox.js";
import { finalizeDisconnectedSessionsDrive } from "./api-data-drive.js";
import { dropboxOAuthCallback } from "./api-dropbox.js";
import {
  githubOAuthCallback,
  githubCreateAndPublish,
  githubDeleteRepository,
  githubGetRepository,
  githubUpdateHtml,
} from "./api-github.js";
import { googleDriveOAuthCallback } from "./api-google-drive.js";
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({
  maxInstances: 20,
});

export {
  apiDataHandler as apidata,
  dropboxOAuthCallback,
  finalizeDisconnectedSessionsDrive,
  finalizeDisconnectedSessionsDropbox,
  githubOAuthCallback,
  githubCreateAndPublish,
  githubDeleteRepository,
  githubGetRepository,
  githubUpdateHtml,
  googleDriveOAuthCallback,
};
