import { apiData, finalizeDisconnectedSessions } from "./routes/data.js";
import { apiDeleteExperiment } from "./routes/experiments.js";
import { dropboxOAuthCallback } from "./api-dropbox.js";
import { githubOAuthCallback } from "./api-github.js";
import { publishExperiment } from "./routes/github.js";
import { googleDriveOAuthCallback } from "./api-google-drive.js";
import { osfManage } from "./api-osf.js";
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({
  maxInstances: 20,
});

export {
  apiData,
  apiDeleteExperiment,
  finalizeDisconnectedSessions,
  dropboxOAuthCallback,
  githubOAuthCallback,
  publishExperiment,
  googleDriveOAuthCallback,
  osfManage,
};
