import { db } from "../../app.js";
import { createFolder, deleteFolder } from "../sessions/services/folder.js";
import { getValidToken } from "../../oauth/index.js";
import fetch from "../../utils/fetch-with-timeout.js";

export async function handleProviderChange(
  experimentRef,
  currentData,
  newProvider,
  uid,
  repoName,
) {
  const currentProvider = currentData.storageProvider || "googledrive";

  if (currentProvider === newProvider) {
    return { ok: true };
  }

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
      // Fix: createFolder for OSF expects projectId, not a filesystem path.
      // If projectId resolution fails, skip createFolder entirely (else
      // we'd call createFolder("osf", token, "/ExpBuilder/...", name)
      // and corrupt OSF state).
      let osfReady = newProvider !== "osf";

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
            osfReady = true;
          } else {
            // Crear proyecto si no existe
            console.log(`[PROVIDER CHANGE] Creating OSF project for user...`);
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
              osfReady = true;
              console.log(
                `[PROVIDER CHANGE] OSF project created: ${folderPath}`,
              );
            } else {
              console.error(`[PROVIDER CHANGE] Failed to create OSF project`);
            }
          }
        }
      }

      if (!osfReady) {
        console.warn(
          `[PROVIDER CHANGE] Skipping createFolder for OSF — projectId unresolved (no userDoc or project creation failed). Experiment storageProvider is set to "osf" but no OSF component was created.`,
        );
        return {
          ok: false,
          response: {
            status: 400,
            body: {
              success: false,
              message:
                "Could not resolve OSF projectId for user. Cannot switch experiment to OSF without a valid OSF project.",
            },
          },
        };
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
          console.log(`[PROVIDER CHANGE] Updating Drive fields:`, updateFields);
        } else if (newProvider === "dropbox") {
          updateFields.dropboxFolder = folderPath;
          console.log(
            `[PROVIDER CHANGE] Updating Dropbox fields:`,
            updateFields,
          );
        } else if (newProvider === "osf") {
          updateFields.osfComponentId = folderResult.componentId;
          updateFields.osfUploadLink = folderResult.uploadLink;
          console.log(`[PROVIDER CHANGE] Updating OSF fields:`, updateFields);
        }

        await experimentRef.update(updateFields);
        console.log(`[PROVIDER CHANGE] Firestore updated successfully`);

        // E-8: new provider folder is live — delete the old provider's
        // folder so it doesn't linger as orphaned data. Done AFTER the
        // new folder is confirmed so we never lose both. Best-effort:
        // if the old provider's token is gone, skip and warn.
        let oldFolderIdentifier = null;
        if (currentProvider === "googledrive") {
          oldFolderIdentifier = currentData.driveFolderId;
        } else if (currentProvider === "dropbox") {
          oldFolderIdentifier = currentData.dropboxFolder;
        } else if (currentProvider === "osf") {
          oldFolderIdentifier = currentData.osfComponentId;
        }

        try {
          if (oldFolderIdentifier) {
            const oldTokenResult = await getValidToken(currentProvider, uid);
            if (oldTokenResult.success) {
              const delResult = await deleteFolder(
                currentProvider,
                oldTokenResult.access_token,
                oldFolderIdentifier,
              );
              console.log(
                `[PROVIDER CHANGE] Old ${currentProvider} folder cleanup: ${delResult.success ? "ok" : delResult.errorText}`,
              );
            } else {
              console.warn(
                `[PROVIDER CHANGE] Skipping old folder cleanup — no valid ${currentProvider} token`,
              );
            }
          }
        } catch (cleanupErr) {
          console.warn(
            `[PROVIDER CHANGE] Old folder cleanup failed (non-fatal):`,
            cleanupErr.message,
          );
        }

        // Clear stale provider-specific fields from Firestore even when
        // best-effort remote cleanup fails.
        const clearFields = {};
        if (
          currentProvider === "googledrive" &&
          newProvider !== "googledrive"
        ) {
          clearFields.driveFolderPath = null;
          clearFields.driveFolderId = null;
        }
        if (currentProvider === "dropbox" && newProvider !== "dropbox") {
          clearFields.dropboxFolder = null;
        }
        if (currentProvider === "osf" && newProvider !== "osf") {
          clearFields.osfComponentId = null;
          clearFields.osfUploadLink = null;
        }
        if (Object.keys(clearFields).length > 0) {
          await experimentRef.update(clearFields);
        }
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

  return { ok: true };
}
