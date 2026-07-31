export { createRepositoryGithub } from "./repository.js";
export { uploadFileGithub } from "./contents.js";
export { enableGithubPages } from "./pages.js";
export { deleteRepositoryGithub } from "./delete.js";
export { waitForGithubRepoReady } from "./ready.js";
export { getRepositoryInfo } from "./info.js";

import { createRepositoryGithub } from "./repository.js";
import { uploadFileGithub } from "./contents.js";
import { enableGithubPages } from "./pages.js";
import { deleteRepositoryGithub } from "./delete.js";
import { getRepositoryInfo } from "./info.js";

export default {
  createRepositoryGithub,
  uploadFileGithub,
  enableGithubPages,
  deleteRepositoryGithub,
  getRepositoryInfo,
};
