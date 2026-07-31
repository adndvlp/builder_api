import {
  createRepositoryGithub,
  enableGithubPages,
  getRepositoryInfo,
  waitForGithubRepoReady,
} from "../hosting/services.js";

/**
 * Ensure the GitHub repository exists and is ready to accept commits.
 * Combines getRepositoryInfo + createRepositoryGithub + waitForGithubRepoReady.
 *
 * @returns {Promise<{success: true, repoExists: boolean} | {success: false, errorText: string}>}
 */
export async function provisionRepository(
  accessToken,
  owner,
  repoName,
  isPrivate,
  description,
) {
  console.log("Checking if repository exists...");
  const repoInfoResult = await getRepositoryInfo(accessToken, owner, repoName);
  const repoExists = repoInfoResult.success;

  if (repoExists) {
    console.log("Repository already exists, updating...");
    return { success: true, repoExists: true };
  }

  console.log("Repository does not exist. Creating...");
  const createRepoResult = await createRepositoryGithub(
    accessToken,
    repoName,
    isPrivate,
    description,
  );

  if (!createRepoResult.success) {
    return { success: false, errorText: createRepoResult.errorText };
  }

  // Ho-3: distinguish "newly created" from "already existed" in the log.
  console.log(
    createRepoResult.existed
      ? `Repository already existed: ${owner}/${repoName}`
      : `Repository created: ${owner}/${repoName}`,
  );

  // E-7 fix: poll hasta que default branch exista en vez de setTimeout fijo
  const readyResult = await waitForGithubRepoReady(
    accessToken,
    owner,
    repoName,
  );
  if (!readyResult.success) {
    console.warn(
      `GitHub repo readiness poll timed out: ${readyResult.errorText}. Proceeding anyway.`,
    );
  } else {
    console.log(`Repo ready after ${readyResult.waitedMs}ms`);
  }
  return { success: true, repoExists: false };
}

/**
 * Enable/verify GitHub Pages. Falls back to constructing the estimated URL
 * when the API call fails so the client still gets a usable link.
 *
 * @returns {Promise<string>} pages URL (always returns a URL)
 */
export async function enablePages(accessToken, owner, repoName) {
  console.log("Enabling/verifying GitHub Pages...");
  const enablePagesResult = await enableGithubPages(
    accessToken,
    owner,
    repoName,
    "main",
    "/",
  );

  if (enablePagesResult.success) {
    console.log("GitHub Pages is active:", enablePagesResult.pagesUrl);
    return enablePagesResult.pagesUrl;
  }

  const estimated = `https://${owner}.github.io/${repoName}/`;
  console.warn(
    "Could not verify GitHub Pages, using estimated URL:",
    estimated,
  );
  return estimated;
}
