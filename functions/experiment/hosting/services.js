import { getHostingProvider } from "./provider-registry.js";

const github = getHostingProvider("github");

export const createRepositoryGithub = github.createRepositoryGithub;
export const uploadFileGithub = github.uploadFileGithub;
export const enableGithubPages = github.enableGithubPages;
export const deleteRepositoryGithub = github.deleteRepositoryGithub;
export const waitForGithubRepoReady = github.waitForGithubRepoReady;
export const getRepositoryInfo = github.getRepositoryInfo;

export { getHostingProvider };
