import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../app.js";
import writeLog from "../write-log.js";
import { createFolder, deleteFolder } from "../services/storage.js";
import { getValidToken } from "../services/oauth.js";
import { deleteRepositoryGithub } from "../crud-file-github.js";
import fetch from "node-fetch";

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
 * Endpoint HTTP para crear un experimento
 */
export const apiCreateExperiment = onRequest(
  { cors: true },
  async (req, res) => {
    const { experimentID, experimentName, uid, storageProvider } = req.body;

    if (!experimentID || !experimentName) {
      res.status(400).json({
        success: false,
        message: "Missing required parameters: experimentID or experimentName",
      });
      return;
    }

    // Validar storageProvider
    const provider = storageProvider || "googledrive";
    if (!["dropbox", "googledrive"].includes(provider)) {
      res.status(400).json({
        success: false,
        message: "Invalid storageProvider. Must be 'dropbox' or 'googledrive'",
      });
      return;
    }

    try {
      const result = await createExperiment(
        experimentID,
        experimentName,
        uid,
        provider,
      );
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: `Internal server error: ${error.message}`,
      });
    }
  },
);

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
