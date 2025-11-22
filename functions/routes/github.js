import { onRequest } from "firebase-functions/v2/https";
import { db } from "../app.js";
import fetch from "node-fetch";
import {
  createRepositoryGithub,
  uploadFileGithub,
  enableGithubPages,
  deleteRepositoryGithub,
  getRepositoryInfo,
} from "../crud-file-github.js";
import { createExperiment } from "./experiments.js";
import { getValidToken } from "../services/oauth.js";
import { createFolder } from "../services/storage.js";

/**
 * Obtiene el token de GitHub de un usuario
 * @param {string} uid - ID del usuario
 * @returns {Promise<Object>} - Objeto con el token de acceso o error
 */
async function getGithubToken(uid) {
  try {
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return {
        success: false,
        error: "User not found",
      };
    }

    const userData = userDoc.data();
    const githubTokens = userData.githubTokens;

    if (!githubTokens || !githubTokens.access_token) {
      return {
        success: false,
        error: "No GitHub token found for user",
      };
    }

    return {
      success: true,
      access_token: githubTokens.access_token,
    };
  } catch (error) {
    console.error("Error getting GitHub token:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Obtiene el owner (username) de GitHub del usuario
 */
async function getGithubOwner(accessToken) {
  const userResponse = await fetch("https://api.github.com/user", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  const userData = await userResponse.json();

  if (!userResponse.ok) {
    throw new Error(
      userData.message || "Error getting GitHub user information"
    );
  }

  return userData.login;
}

/**
 * Endpoint unificado para publicar experimento en GitHub
 * Crea el repositorio si no existe, sube el contenido HTML y habilita GitHub Pages
 *
 * POST body:
 * - uid: ID del usuario
 * - repoName: Nombre del repositorio
 * - htmlContent: Contenido del archivo HTML
 * - isPrivate: Si el repositorio debe ser privado (default: false)
 * - description: Descripción del repositorio (opcional)
 * - mediaFiles: Array de archivos multimedia (opcional)
 */
export const publishExperiment = onRequest({ cors: true }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const {
      uid,
      repoName,
      htmlContent,
      isPrivate = false,
      description = "",
      mediaFiles,
      experimentID,
      storageProvider,
    } = req.body;

    // Validar parámetros requeridos
    if (!uid || !repoName || !htmlContent) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: uid, repoName, or htmlContent",
      });
    }

    console.log(
      "Publishing experiment to GitHub for user:",
      uid,
      "repo:",
      repoName
    );

    // Verificar si el experimento existe en Firestore
    if (experimentID) {
      const experimentRef = db.collection("experiments").doc(experimentID);
      const experimentDoc = await experimentRef.get();

      if (!experimentDoc.exists) {
        // El experimento no existe, crearlo
        console.log("Experiment not found in Firestore. Creating...");
        const provider = storageProvider || "googledrive";

        try {
          const createResult = await createExperiment(
            experimentID,
            repoName,
            uid,
            provider
          );
          console.log("Experiment created in Firestore:", createResult);
        } catch (createError) {
          console.warn(
            "Warning: Could not create experiment in Firestore:",
            createError.message
          );
          // No detener la publicación, solo advertir
        }
      } else {
        console.log("Experiment already exists in Firestore");

        // Actualizar storage provider si es diferente
        const currentData = experimentDoc.data();
        const currentProvider = currentData.storageProvider || "googledrive";
        const newProvider = storageProvider || "googledrive";

        if (currentProvider !== newProvider) {
          console.log(
            `Updating storage provider from ${currentProvider} to ${newProvider}`
          );

          try {
            // Actualizar el storage provider en Firestore
            await experimentRef.update({
              storageProvider: newProvider,
            });

            // Crear la nueva carpeta en el nuevo storage
            const tokenResult = await getValidToken(newProvider, uid);
            if (tokenResult.success) {
              const folderPath = `/ExpBuilder/${repoName}`;
              const folderResult = await createFolder(
                newProvider,
                tokenResult.access_token,
                folderPath
              );

              if (folderResult.success) {
                console.log(`Folder created in ${newProvider}: ${folderPath}`);

                // Actualizar campos específicos del proveedor
                const updateFields = {};
                if (newProvider === "googledrive") {
                  updateFields.driveFolderPath = folderPath;
                  updateFields.driveFolderId = folderResult.folderId;
                } else if (newProvider === "dropbox") {
                  updateFields.dropboxFolder = folderPath;
                }

                await experimentRef.update(updateFields);
              } else {
                console.warn(
                  `Warning: Could not create folder in ${newProvider}:`,
                  folderResult.errorText
                );
              }
            }
          } catch (updateError) {
            console.warn(
              "Warning: Could not update storage provider:",
              updateError.message
            );
          }
        }
      }
    }

    // Obtener el token de GitHub
    const tokenResult = await getGithubToken(uid);
    if (!tokenResult.success) {
      return res.status(400).json({
        success: false,
        message: "GitHub token not found or invalid",
        error: tokenResult.error,
      });
    }

    const accessToken = tokenResult.access_token;
    const owner = await getGithubOwner(accessToken);

    // Verificar si el repositorio ya existe
    console.log("Checking if repository exists...");
    const repoInfoResult = await getRepositoryInfo(
      accessToken,
      owner,
      repoName
    );

    let repoExists = repoInfoResult.success;

    // Si no existe, crearlo
    if (!repoExists) {
      console.log("Repository does not exist. Creating...");
      const createRepoResult = await createRepositoryGithub(
        accessToken,
        repoName,
        isPrivate,
        description
      );

      if (!createRepoResult.success) {
        return res.status(400).json({
          success: false,
          message: "Error creating repository",
          error: createRepoResult.errorText,
        });
      }

      console.log("Repository created:", owner, "/", repoName);
    } else {
      console.log("Repository already exists, updating...");
    }

    // Subir/actualizar el archivo HTML
    console.log("Uploading/updating index.html...");
    const uploadHtmlResult = await uploadFileGithub(
      accessToken,
      owner,
      repoName,
      "index.html",
      htmlContent,
      repoExists ? "Update experiment HTML" : "Add experiment HTML file"
    );

    if (!uploadHtmlResult.success) {
      return res.status(400).json({
        success: false,
        message: "Error uploading HTML file",
        error: uploadHtmlResult.errorText,
      });
    }

    console.log("HTML file uploaded successfully");

    // Subir archivos multimedia si se proporcionan
    if (mediaFiles && Array.isArray(mediaFiles)) {
      console.log(`Uploading ${mediaFiles.length} media files...`);
      for (const file of mediaFiles) {
        if (!file.type || !file.filename || !file.content) continue;

        let folder = "";
        if (file.type === "img") folder = "img";
        else if (file.type === "vid") folder = "vid";
        else if (file.type === "aud") folder = "aud";
        else continue;

        const filePath = `${folder}/${file.filename}`;

        // Si el contenido es base64, convertir a buffer
        let fileContent = file.content;
        if (/^([A-Za-z0-9+/=]+)$/.test(fileContent)) {
          fileContent = Buffer.from(fileContent, "base64");
        }

        const uploadResult = await uploadFileGithub(
          accessToken,
          owner,
          repoName,
          filePath,
          fileContent,
          `Upload ${file.type} file: ${file.filename}`
        );

        if (!uploadResult.success) {
          console.warn(
            `Error uploading media file ${file.filename}:`,
            uploadResult.errorText
          );
        } else {
          console.log(`Media file uploaded: ${filePath}`);
        }
      }
    }

    // Habilitar/verificar GitHub Pages
    console.log("Enabling/verifying GitHub Pages...");
    const enablePagesResult = await enableGithubPages(
      accessToken,
      owner,
      repoName,
      "main",
      "/"
    );

    let pagesUrl;
    if (enablePagesResult.success) {
      pagesUrl = enablePagesResult.pagesUrl;
      console.log("GitHub Pages is active:", pagesUrl);
    } else {
      // Si falla, construir la URL estimada
      pagesUrl = `https://${owner}.github.io/${repoName}/`;
      console.warn(
        "Could not verify GitHub Pages, using estimated URL:",
        pagesUrl
      );
    }

    // Retornar el resultado exitoso
    return res.status(repoExists ? 200 : 201).json({
      success: true,
      message: repoExists
        ? "Experiment updated and published successfully"
        : "Experiment created and published successfully",
      repoUrl: `https://github.com/${owner}/${repoName}`,
      pagesUrl: pagesUrl,
      owner: owner,
      repoName: repoName,
    });
  } catch (error) {
    console.error("Error in publishExperiment:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});
