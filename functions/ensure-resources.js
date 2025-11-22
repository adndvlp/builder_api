import { createFolder } from "./services/storage.js";
import {
  createRepositoryGithub,
  getRepositoryInfo,
} from "./crud-file-github.js";

/**
 * Verifica y crea recursos (carpeta en Drive y repo en GitHub) solo si no existen
 * @param {Object} params
 * @param {string} params.driveToken - Token de Google Drive
 * @param {string} params.folderPath - Ruta de la carpeta en Drive
 * @param {string} params.githubToken - Token de GitHub
 * @param {string} params.repoName - Nombre del repo en GitHub
 * @param {string} params.githubOwner - Usuario/owner de GitHub
 * @returns {Promise<Object>} - Estado de los recursos
 */
export async function ensureResourcesExist({
  driveToken,
  folderPath,
  githubToken,
  repoName,
  githubOwner,
}) {
  let driveFolderCreated = false;
  let driveFolderId = null;
  let driveError = null;
  let repoCreated = false;
  let repoUrl = null;
  let repoError = null;

  // Google Drive: intentar crear solo si no existe
  try {
    const folderResult = await createFolder(
      "googledrive",
      driveToken,
      folderPath
    );
    if (folderResult.success) {
      driveFolderCreated = !folderResult.message?.includes("already exists");
      driveFolderId = folderResult.folderId;
    } else {
      driveError = folderResult.errorText;
    }
  } catch (err) {
    driveError = err.message;
  }

  // GitHub: verificar si existe y crear solo si no existe
  try {
    const repoInfo = await getRepositoryInfo(
      githubToken,
      githubOwner,
      repoName
    );
    if (repoInfo.success) {
      repoUrl = repoInfo.repo.url;
    } else if (repoInfo.errorCode === 404) {
      // No existe, crear
      const repoResult = await createRepositoryGithub(githubToken, repoName);
      if (repoResult.success) {
        repoCreated = true;
        repoUrl = repoResult.repoUrl;
      } else {
        repoError = repoResult.errorText;
      }
    } else {
      repoError = repoInfo.errorText;
    }
  } catch (err) {
    repoError = err.message;
  }

  return {
    driveFolderCreated,
    driveFolderId,
    driveError,
    repoCreated,
    repoUrl,
    repoError,
  };
}
