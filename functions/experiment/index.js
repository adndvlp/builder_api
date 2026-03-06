import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../app.js";
import writeLog from "./sessions/write-log.js";
import { createFolder, deleteFolder } from "./sessions/services/folder.js";
import { getValidToken } from "../oauth/index.js";
import { deleteRepositoryGithub } from "./hosting/services.js";
import fetch from "node-fetch";
import {
  createRepositoryGithub,
  uploadFileGithub,
  enableGithubPages,
  getRepositoryInfo,
} from "./hosting/services.js";

import { getGithubToken, getGithubOwner } from "../oauth/github-token.js";

/**
 * Función reutilizable para crear experimento
 * @param {string} experimentID - ID del experimento
 * @param {string} experimentName - Nombre del experimento
 * @param {string} uid - ID del usuario (opcional)
 * @param {string} storageProvider - Proveedor de almacenamiento ('dropbox' o 'googledrive')
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function createExperiment(
  experimentID,
  experimentName,
  uid,
  storageProvider = "googledrive",
) {
  await writeLog(experimentID, "createExperiment");

  const folderPath = `/ExpBuilder/${experimentName}`;

  let folderCreated = false;
  let folderId = null;
  let uploadLink = null; // Para OSF
  let storageError = null;

  if (uid) {
    try {
      const tokenResult = await getValidToken(storageProvider, uid);

      if (tokenResult.success) {
        // Para OSF, necesitamos el projectId del usuario
        let projectPath = folderPath;
        if (storageProvider === "osf") {
          const userDoc = await db.collection("users").doc(uid).get();
          const userData = userDoc.data();
          projectPath = userData.osfProjectId || folderPath;
        }

        const folderResult = await createFolder(
          storageProvider,
          tokenResult.access_token,
          projectPath,
          experimentName, // componentName para OSF
        );

        if (folderResult.success) {
          folderCreated = true;
          folderId = folderResult.folderId || folderResult.componentId; // Google Drive o OSF
          uploadLink = folderResult.uploadLink; // Solo para OSF
        } else {
          storageError = folderResult.errorText;
        }
      } else {
        storageError = `Token error: ${tokenResult.error}`;
      }
    } catch (error) {
      storageError = error.message;
    }
  }

  // Configurar campos específicos del proveedor
  const providerFields = {};
  if (storageProvider === "googledrive") {
    providerFields.driveFolderPath = folderPath;
    providerFields.driveFolderId = folderId;
  } else if (storageProvider === "dropbox") {
    providerFields.dropboxFolder = folderPath;
  } else if (storageProvider === "osf") {
    providerFields.osfComponentId = folderId;
    providerFields.osfUploadLink = uploadLink;
  }

  // Guardar experimento en Firestore
  const experimentRef = db.collection("experiments").doc(experimentID);
  await experimentRef.set({
    title: experimentName,
    ...providerFields,
    storageProvider: storageProvider,
    active: true,
    sessions: 0,
    limitSessions: false,
    maxSessions: 1,
    id: experimentID,
    useValidation: true,
    allowJSON: true,
    allowCSV: true,
    requiredFields: ["trial_type"],
    activeConditionAssignment: true,
    nConditions: 1,
    currentCondition: 0,
    createdAt: FieldValue.serverTimestamp(),
    ...(uid && { owner: uid }),
  });

  return {
    success: true,
    message: "Experiment created successfully",
    experimentID: experimentID,
    folderPath: folderPath,
    ...(folderId && { folderId }),
    folderCreated: folderCreated,
    ...(storageError && { storageError }),
  };
}

/**
 * Función reutilizable para eliminar experimento
 * @param {string} experimentID - ID del experimento
 * @param {string} uid - ID del usuario (opcional)
 * @param {string} repoName - Nombre del repositorio de GitHub (opcional)
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function deleteExperiment(experimentID, uid, repoName = null) {
  await writeLog(experimentID, "deleteExperiment");

  const experimentRef = db.collection("experiments").doc(experimentID);
  const experimentDoc = await experimentRef.get();

  if (!experimentDoc.exists) {
    throw new Error("EXPERIMENT_NOT_FOUND");
  }

  const experimentData = experimentDoc.data();
  const storageProvider = experimentData.storageProvider || "googledrive";

  // Obtener el identificador de carpeta según el proveedor
  let folderIdentifier;
  if (storageProvider === "googledrive") {
    folderIdentifier = experimentData.driveFolderPath;
  } else if (storageProvider === "dropbox") {
    folderIdentifier = experimentData.dropboxFolder;
  }

  let folderDeleted = false;
  let storageError = null;
  let repoDeleted = false;
  let repoError = null;

  // Eliminar carpeta de almacenamiento (Dropbox/Drive)
  if (uid && folderIdentifier) {
    try {
      const tokenResult = await getValidToken(storageProvider, uid);

      if (tokenResult.success) {
        const deleteResult = await deleteFolder(
          storageProvider,
          tokenResult.access_token,
          folderIdentifier,
        );

        if (deleteResult.success) {
          folderDeleted = true;
        } else {
          storageError = deleteResult.errorText;
          console.error(
            `Error deleting ${storageProvider} folder:`,
            storageError,
          );
        }
      } else {
        storageError = `Token error: ${tokenResult.error}`;
        console.error(
          `Error getting valid ${storageProvider} token:`,
          tokenResult.error,
        );
      }
    } catch (error) {
      console.error("Error accessing user data or deleting folder:", error);
      storageError = error.message;
    }
  }

  // Eliminar repositorio de GitHub
  if (uid) {
    try {
      const userDoc = await db.collection("users").doc(uid).get();

      if (userDoc.exists) {
        const userData = userDoc.data();
        const githubTokens = userData.githubTokens;

        if (githubTokens && githubTokens.access_token) {
          const accessToken = githubTokens.access_token;

          // Obtener el username de GitHub
          const userResponse = await fetch("https://api.github.com/user", {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          });

          if (userResponse.ok) {
            const githubUser = await userResponse.json();
            const owner = githubUser.login;

            // Intentar eliminar el repositorio usando repoName si se proporciona, sino experimentData.title o experimentID
            const repoToDelete =
              repoName || experimentData.title || experimentID;
            const deleteRepoResult = await deleteRepositoryGithub(
              accessToken,
              owner,
              repoToDelete,
            );

            if (deleteRepoResult.success) {
              repoDeleted = true;
              console.log(
                `GitHub repository ${repoToDelete} deleted successfully`,
              );
            } else {
              // Si el error es 404, significa que el repo no existía (no es un error crítico)
              if (deleteRepoResult.errorCode === 404) {
                console.log(`GitHub repository ${repoToDelete} does not exist`);
              } else {
                repoError = deleteRepoResult.errorText;
                console.error(`Error deleting GitHub repository:`, repoError);
              }
            }
          }
        }
      }
    } catch (error) {
      repoError = error.message;
      console.error("Error deleting GitHub repository:", error);
    }
  }

  await experimentRef.delete();

  return {
    success: true,
    message: "Experiment deleted successfully",
    experimentID: experimentID,
    folderDeleted: folderDeleted,
    repoDeleted: repoDeleted,
    ...(storageError && { storageWarning: storageError }),
    ...(repoError && { repoWarning: repoError }),
  };
}

/**
 * Endpoint HTTP para eliminar un experimento
 */
export const apiDeleteExperiment = onRequest(
  { cors: true },
  async (req, res) => {
    const { experimentID, uid, repoName } = req.body;

    if (!experimentID) {
      res.status(400).json({
        success: false,
        message: "Missing required parameter: experimentID",
      });
      return;
    }

    try {
      const result = await deleteExperiment(experimentID, uid, repoName);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === "EXPERIMENT_NOT_FOUND") {
        res.status(404).json({
          success: false,
          message: "Experiment not found",
        });
      } else {
        console.error("Error deleting experiment:", error);
        res.status(500).json({
          success: false,
          message: `Internal server error: ${error.message}`,
        });
      }
    }
  },
);

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
      repoName,
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
          // Si es OSF, verificar/crear proyecto
          if (provider === "osf") {
            const userDoc = await db.collection("users").doc(uid).get();
            if (userDoc.exists) {
              const userData = userDoc.data();
              if (!userData.osfProjectId) {
                console.log("[NEW EXPERIMENT] Creating OSF project...");
                const tokenResult = await getValidToken("osf", uid);
                if (tokenResult.success) {
                  const projectResponse = await fetch(
                    "https://api.osf.io/v2/nodes/?region=us",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${tokenResult.access_token}`,
                      },
                      body: JSON.stringify({
                        data: {
                          type: "nodes",
                          attributes: {
                            title: "ExpBuilder",
                            category: "project",
                            description: "Experiment Builder data storage",
                            public: false,
                          },
                        },
                      }),
                    },
                  );

                  if (projectResponse.ok) {
                    const projectData = await projectResponse.json();
                    const osfProjectId = projectData.data.id;
                    await db.collection("users").doc(uid).update({
                      osfProjectId: osfProjectId,
                    });
                    console.log(
                      "[NEW EXPERIMENT] OSF project created:",
                      osfProjectId,
                    );
                  }
                }
              }
            }
          }

          const createResult = await createExperiment(
            experimentID,
            repoName,
            uid,
            provider,
          );
          console.log("Experiment created in Firestore:", createResult);
        } catch (createError) {
          console.warn(
            "Warning: Could not create experiment in Firestore:",
            createError.message,
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
            `Updating storage provider from ${currentProvider} to ${newProvider}`,
          );

          try {
            // Actualizar el storage provider en Firestore
            await experimentRef.update({
              storageProvider: newProvider,
            });

            // Crear la nueva carpeta en el nuevo storage
            const tokenResult = await getValidToken(newProvider, uid);
            console.log(
              `[PROVIDER CHANGE] Token result for ${newProvider}:`,
              tokenResult.success,
            );

            if (tokenResult.success) {
              let folderPath = `/ExpBuilder/${repoName}`;
              let componentName = repoName;

              // Para OSF, obtener projectId del usuario
              if (newProvider === "osf") {
                console.log(
                  `[PROVIDER CHANGE] OSF detected, fetching user data for uid: ${uid}`,
                );
                const userDoc = await db.collection("users").doc(uid).get();
                if (!userDoc.exists) {
                  console.error(
                    `[PROVIDER CHANGE] User document not found for uid: ${uid}`,
                  );
                } else {
                  const userData = userDoc.data();
                  console.log(
                    `[PROVIDER CHANGE] User osfProjectId: ${userData?.osfProjectId}`,
                  );
                  if (userData?.osfProjectId) {
                    folderPath = userData.osfProjectId;
                  } else {
                    // Crear proyecto si no existe
                    console.log(
                      `[PROVIDER CHANGE] Creating OSF project for user...`,
                    );
                    const projectResponse = await fetch(
                      "https://api.osf.io/v2/nodes/?region=us",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${tokenResult.access_token}`,
                        },
                        body: JSON.stringify({
                          data: {
                            type: "nodes",
                            attributes: {
                              title: "ExpBuilder",
                              category: "project",
                              description: "Experiment Builder data storage",
                              public: false,
                            },
                          },
                        }),
                      },
                    );

                    if (projectResponse.ok) {
                      const projectData = await projectResponse.json();
                      folderPath = projectData.data.id;
                      await db.collection("users").doc(uid).update({
                        osfProjectId: folderPath,
                      });
                      console.log(
                        `[PROVIDER CHANGE] OSF project created: ${folderPath}`,
                      );
                    } else {
                      console.error(
                        `[PROVIDER CHANGE] Failed to create OSF project`,
                      );
                    }
                  }
                }
              }

              console.log(
                `[PROVIDER CHANGE] Calling createFolder with provider=${newProvider}, folderPath=${folderPath}, componentName=${componentName}`,
              );

              const folderResult = await createFolder(
                newProvider,
                tokenResult.access_token,
                folderPath,
                componentName,
              );

              console.log(
                `[PROVIDER CHANGE] createFolder result:`,
                JSON.stringify(folderResult),
              );

              if (folderResult.success) {
                console.log(`Folder created in ${newProvider}: ${folderPath}`);

                // Actualizar campos específicos del proveedor
                const updateFields = {};
                if (newProvider === "googledrive") {
                  updateFields.driveFolderPath = folderPath;
                  updateFields.driveFolderId = folderResult.folderId;
                  console.log(
                    `[PROVIDER CHANGE] Updating Drive fields:`,
                    updateFields,
                  );
                } else if (newProvider === "dropbox") {
                  updateFields.dropboxFolder = folderPath;
                  console.log(
                    `[PROVIDER CHANGE] Updating Dropbox fields:`,
                    updateFields,
                  );
                } else if (newProvider === "osf") {
                  updateFields.osfComponentId = folderResult.componentId;
                  updateFields.osfUploadLink = folderResult.uploadLink;
                  console.log(
                    `[PROVIDER CHANGE] Updating OSF fields:`,
                    updateFields,
                  );
                }

                await experimentRef.update(updateFields);
                console.log(`[PROVIDER CHANGE] Firestore updated successfully`);
              } else {
                console.warn(
                  `Warning: Could not create folder in ${newProvider}:`,
                  folderResult.errorText,
                );
              }
            } else {
              console.error(
                `[PROVIDER CHANGE] Failed to get valid token for ${newProvider}:`,
                tokenResult.error,
              );
            }
          } catch (updateError) {
            console.warn(
              "Warning: Could not update storage provider:",
              updateError.message,
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
      repoName,
    );

    let repoExists = repoInfoResult.success;

    // Si no existe, crearlo
    if (!repoExists) {
      console.log("Repository does not exist. Creating...");
      const createRepoResult = await createRepositoryGithub(
        accessToken,
        repoName,
        isPrivate,
        description,
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
      repoExists ? "Update experiment HTML" : "Add experiment HTML file",
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
          `Upload ${file.type} file: ${file.filename}`,
        );

        if (!uploadResult.success) {
          console.warn(
            `Error uploading media file ${file.filename}:`,
            uploadResult.errorText,
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
      "/",
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
        pagesUrl,
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
