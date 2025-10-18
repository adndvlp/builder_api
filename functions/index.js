import { apiData, finalizeDisconnectedSessions } from "./api-data.js";
import { apiCreateExperiment } from "./api-create-experiment.js";
import { apiDeleteExperiment } from "./api-delete-experiment.js";
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
  apiData as apidata,
  apiCreateExperiment as apicreateexperiment,
  apiDeleteExperiment as apideleteexperiment,
  dropboxOAuthCallback,
  githubOAuthCallback,
  githubCreateAndPublish,
  githubDeleteRepository,
  githubGetRepository,
  githubUpdateHtml,
  googleDriveOAuthCallback,
  finalizeDisconnectedSessions,
};
