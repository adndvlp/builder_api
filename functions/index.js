import {
  apiData,
  apiDataComplete,
  finalizeDisconnectedSessions,
} from "./routes/data.js";
import { apiDeleteExperiment } from "./routes/experiments.js";
import { apiCondition } from "./api-condition.js";
import { dropboxOAuthCallback } from "./api-dropbox.js";
import { githubOAuthCallback } from "./api-github.js";
import { publishExperiment } from "./routes/github.js";
import { googleDriveOAuthCallback } from "./api-google-drive.js";
import { osfManage } from "./api-osf.js";
import { osfOAuthCallback } from "./api-osf-oauth.js";
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
};
