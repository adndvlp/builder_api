import {
  apiData,
  apiDataComplete,
  finalizeDisconnectedSessions,
} from "./experiment/sessions/index.js";
import { publishExperiment } from "./experiment/index.js";
import { apiDeleteExperiment } from "./experiment/index.js";
import { apiCondition } from "./experiment/api-condition.js";
import { dropboxOAuthCallback } from "./oauth/callbacks/dropbox.js";
import { githubOAuthCallback } from "./oauth/callbacks/github.js";
import { googleDriveOAuthCallback } from "./oauth/callbacks/google-drive.js";
import { osfOAuthCallback } from "./oauth/callbacks/osf.js";
import { osfManage } from "./oauth/osf-token.js";
import { uploadParticipantFile } from "./experiment/participant-files.js";
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({
  maxInstances: 20,
});

export {
  apiData,
  apiDataComplete,
  apiDeleteExperiment,
  apiCondition,
  finalizeDisconnectedSessions,
  dropboxOAuthCallback,
  githubOAuthCallback,
  publishExperiment,
  googleDriveOAuthCallback,
  osfManage,
  osfOAuthCallback,
  uploadParticipantFile,
};
