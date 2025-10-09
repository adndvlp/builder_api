import { apiData } from "./api-data.js";
import { apiCondition } from "./api-condition.js";
import { apiBase64 } from "./api-base64.js";
import { apiCreateExperiment } from "./api-create-experiment.js";
import { apiDeleteExperiment } from "./api-delete-experiment.js";
import { dropboxOAuthCallback } from "./api-dropbox.js";
import { githubOAuthCallback } from "./api-github.js";
import { googleDriveOAuthCallback } from "./api-google-drive.js";
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({
  maxInstances: 20,
});

export {
  apiData as apidata,
  apiCondition as apicondition,
  apiBase64 as apibase64,
  apiCreateExperiment as apicreateexperiment,
  apiDeleteExperiment as apideleteexperiment,
  dropboxOAuthCallback,
  githubOAuthCallback,
  googleDriveOAuthCallback,
};
