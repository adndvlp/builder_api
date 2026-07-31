import { getDatabase } from "firebase-admin/database";
import { app, db } from "../app.js";
import writeLog from "./sessions/logging/write-log.js";
import { deleteFolder } from "./sessions/services/folder.js";
import { getValidToken } from "../oauth/index.js";
import { deleteRepositoryGithub } from "./hosting/services.js";
import fetch from "../utils/fetch-with-timeout.js";

/**
 * Stream-delete a collection in page-sized chunks. Optionally drains named
 * subcollections of each doc first. Bounded memory regardless of dataset
 * size — necessary for experiments with thousands of sessions (E-6).
 *
 * @param {FirebaseFirestore.CollectionReference} colRef
 * @param {Object} [options]
 * @param {string[]} [options.deleteSubcollections] - names to drain per doc
 * @param {number}   [options.pageSize=400]
 */
async function paginatedDelete(colRef, options = {}) {
  const pageSize = options.pageSize ?? 400;
  const subcols = options.deleteSubcollections ?? [];

  while (true) {
    const snap = await colRef.limit(pageSize).get();
    if (snap.empty) return;

    for (const doc of snap.docs) {
      for (const sub of subcols) {
        await paginatedDelete(doc.ref.collection(sub), { pageSize });
      }
    }

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    if (snap.size < pageSize) return;
  }
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
  } else if (storageProvider === "osf") {
    // deleteFolder OSF espera componentId (borra el componente entero)
    folderIdentifier = experimentData.osfComponentId;
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

  // E-6: stream subcollections instead of loading every doc into memory.
  // For experiments with thousands of sessions the previous `.get()` on the
  // root collection blew through function memory. `paginatedDelete` reads
  // in pages of 500, deletes via batch, repeats until empty.
  await paginatedDelete(experimentRef.collection("session_metadata"), {
    deleteSubcollections: ["participant_files", "trials"],
  });
  await paginatedDelete(experimentRef.collection("sessions"), {
    deleteSubcollections: ["trials"],
  });

  await experimentRef.delete();

  // Limpiar Realtime Database — sino el trigger finalizeDisconnectedSessions
  // dispara EXPERIMENT_NOT_FOUND para cada sesión activa huérfana
  let rtdbCleared = false;
  let rtdbError = null;
  try {
    await getDatabase(app).ref(`sessions/${experimentID}`).remove();
    rtdbCleared = true;
  } catch (error) {
    rtdbError = error.message;
    console.error(`Error clearing RTDB sessions/${experimentID}:`, error);
  }

  return {
    success: true,
    message: "Experiment deleted successfully",
    experimentID: experimentID,
    rtdbCleared,
    ...(rtdbError && { rtdbWarning: rtdbError }),
    folderDeleted: folderDeleted,
    repoDeleted: repoDeleted,
    ...(storageError && { storageWarning: storageError }),
    ...(repoError && { repoWarning: repoError }),
  };
}
