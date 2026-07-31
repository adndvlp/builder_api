import { onRequest } from "firebase-functions/v2/https";
import { db } from "../../app.js";
import { uploadFileGithub } from "../hosting/services.js";
import { getGithubToken, getGithubOwner } from "../../oauth/providers/github/token.js";
import { requireAuth } from "../../utils/auth.js";
import { uploadMediaFiles } from "./media.js";
import { provisionRepository, enablePages } from "./repo.js";
import { handleProviderChange } from "./provider-change.js";
import { createExperimentIfMissing } from "./create-if-missing.js";

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
  // T-10: CORS headers handled by onRequest({cors:true}).
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // T-2: investigator-only endpoint — require Firebase Auth.
  const authedUid = await requireAuth(req, res);
  if (!authedUid) return;

  try {
    const {
      repoName,
      htmlContent,
      isPrivate = false,
      description = "",
      mediaFiles,
      experimentID,
      storageProvider,
    } = req.body;
    const uid = authedUid;

    // Validar parámetros requeridos
    if (!repoName || !htmlContent) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: repoName or htmlContent",
      });
    }

    // E-12: GitHub rejects names with non-[A-Za-z0-9._-] characters and names
    // starting with `.` or `-`. Reject early with a clear 400 instead of
    // letting GH return 422 mid-flow.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repoName)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid repoName: must be 1-100 chars, only letters/digits/._-, not starting with . or -",
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
        await createExperimentIfMissing(
          experimentID,
          repoName,
          uid,
          storageProvider,
        );
      } else {
        console.log("Experiment already exists in Firestore");

        // Actualizar storage provider si es diferente
        const currentData = experimentDoc.data();
        const currentProvider = currentData.storageProvider || "googledrive";
        const newProvider = storageProvider || "googledrive";

        if (currentProvider !== newProvider) {
          const providerChange = await handleProviderChange(
            experimentRef,
            currentData,
            newProvider,
            uid,
            repoName,
          );
          if (!providerChange.ok) {
            return res
              .status(providerChange.response.status)
              .json(providerChange.response.body);
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

    const provision = await provisionRepository(
      accessToken,
      owner,
      repoName,
      isPrivate,
      description,
    );
    if (!provision.success) {
      return res.status(400).json({
        success: false,
        message: "Error creating repository",
        error: provision.errorText,
      });
    }
    const repoExists = provision.repoExists;

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

    const mediaUploadResults = await uploadMediaFiles(
      accessToken,
      owner,
      repoName,
      mediaFiles,
    );

    const pagesUrl = await enablePages(accessToken, owner, repoName);

    // E-11: aggregate media upload outcome so the client knows which
    // resources are actually live.
    const mediaUploadStats = {
      attempted: mediaUploadResults.length,
      succeeded: mediaUploadResults.filter((r) => r.success).length,
      failed: mediaUploadResults.filter((r) => !r.success),
    };

    return res.status(repoExists ? 200 : 201).json({
      success: true,
      message: repoExists
        ? "Experiment updated and published successfully"
        : "Experiment created and published successfully",
      repoUrl: `https://github.com/${owner}/${repoName}`,
      pagesUrl: pagesUrl,
      owner: owner,
      repoName: repoName,
      mediaUploads: mediaUploadStats,
    });
  } catch (error) {
    console.error("Error in publishExperiment:", error);
    // T-11: don't leak internal error.message to clients.
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});
