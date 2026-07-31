import {
  apiData,
  apiDataComplete,
  finalizeDisconnectedSessions,
} from "./experiment/sessions/index.js";
import { processSessionTimeout } from "./experiment/sessions/timeout/tasks.js";
import { publishExperiment } from "./experiment/index.js";
import { apiDeleteExperiment } from "./experiment/index.js";
import { apiCondition } from "./experiment/api/condition.js";
import { dropboxOAuthCallback } from "./oauth/api/callbacks/dropbox.js";
import { githubOAuthCallback } from "./oauth/api/callbacks/github.js";
import { googleDriveOAuthCallback } from "./oauth/api/callbacks/google-drive.js";
import { osfOAuthCallback } from "./oauth/api/callbacks/osf.js";
import { osfManage } from "./oauth/api/osf-manage.js";
import { createOAuthStateEndpoint } from "./oauth/api/state.js";
import { uploadParticipantFile } from "./experiment/participant-files/api/upload.js";
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
  processSessionTimeout,
  dropboxOAuthCallback,
  githubOAuthCallback,
  publishExperiment,
  googleDriveOAuthCallback,
  osfManage,
  osfOAuthCallback,
  createOAuthStateEndpoint,
  uploadParticipantFile,
};
