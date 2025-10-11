import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import fetch from "node-fetch";
import {
  createRepositoryGithub,
  uploadFileGithub,
  enableGithubPages,
  deleteRepositoryGithub,
  getRepositoryInfo,
} from "./crud-file-github.js";

// Inicializar Firebase Admin si no está inicializado
if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

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

// Configura tus credenciales de GitHub
const CLIENT_ID = "Ov23limim0vbyTd5J4fK";
const CLIENT_SECRET = "cdd3ae03ca594a2c16d8668b7698e816d8faebb0";
const REDIRECT_URI = "http://localhost:5173/github-callback"; // Debe coincidir con el de GitHub Console
// const REDIRECT_URI = "https://test-e4cf9.firebaseapp.com/github-callback"; // Para producción

// Endpoint para el callback de OAuth
export const githubOAuthCallback = onRequest(async (req, res) => {
  // Permitir CORS para desarrollo local
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const code = req.query.code;
  const uid = req.query.state; // GitHub usa "state" para pasar datos

  console.log(
    "Received callback with code:",
    code ? "present" : "missing",
    "uid:",
    uid
  );

  if (!code || !uid) {
    return res.status(400).send("Missing code or uid");
  }

  try {
    console.log("Exchanging code for tokens...");
    // Intercambia el código por tokens
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code,
          redirect_uri: REDIRECT_URI,
        }),
      }
    );

    const tokens = await tokenRes.json();
    console.log(
      "Token response:",
      tokens.access_token ? "Token received" : "No token",
      tokens.error || ""
    );

    if (!tokens.access_token) {
      throw new Error(tokens.error_description || "No access token returned");
    }

    // Guarda los tokens en Firestore bajo el usuario
    console.log("Saving tokens to Firestore for user:", uid);
    await db.collection("users").doc(uid).set(
      {
        githubTokens: tokens,
      },
      { merge: true }
    );

    console.log("GitHub tokens saved successfully!");

    // Redirigir de vuelta a la app con mensaje de éxito
    const redirectUrl =
      process.env.NODE_ENV === "production"
        ? "https://test-e4cf9.firebaseapp.com/settings?status=success&service=github"
        : "http://localhost:5173/settings?status=success&service=github";

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("Error in githubOAuthCallback:", error);

    // Redirigir de vuelta a la app con mensaje de error
    const redirectUrl =
      process.env.NODE_ENV === "production"
        ? `https://test-e4cf9.firebaseapp.com/settings?status=error&service=github&message=${encodeURIComponent(
            error.message
          )}`
        : `http://localhost:5173/settings?status=error&service=github&message=${encodeURIComponent(
            error.message
          )}`;

    return res.redirect(redirectUrl);
  }
});

/**
 * Endpoint para crear un repositorio en GitHub y publicarlo en GitHub Pages
 * POST body:
 * - uid: ID del usuario
 * - repoName: Nombre del repositorio
 * - htmlContent: Contenido del archivo HTML
 * - envContent: Contenido del archivo .env (opcional)
 * - isPrivate: Si el repositorio debe ser privado (default: false)
 * - description: Descripción del repositorio (opcional)
 */
export const githubCreateAndPublish = onRequest(
  { cors: true },
  async (req, res) => {
    // Permitir CORS para desarrollo local
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
        envContent,
        isPrivate = false,
        description = "",
      } = req.body;

      // Validar parámetros requeridos
      if (!uid || !repoName || !htmlContent) {
        return res.status(400).json({
          success: false,
          message: "Missing required parameters: uid, repoName, or htmlContent",
        });
      }

      console.log("Creating GitHub repo for user:", uid, "repo:", repoName);

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

      // Paso 1: Crear el repositorio
      console.log("Step 1: Creating repository...");
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

      const { owner, repoName: createdRepoName } = createRepoResult;
      console.log("Repository created:", owner, "/", createdRepoName);

      // Paso 2: Subir el archivo HTML
      console.log("Step 2: Uploading HTML file...");
      const uploadHtmlResult = await uploadFileGithub(
        accessToken,
        owner,
        createdRepoName,
        "index.html",
        htmlContent,
        "Add experiment HTML file"
      );

      if (!uploadHtmlResult.success) {
        return res.status(400).json({
          success: false,
          message: "Error uploading HTML file",
          error: uploadHtmlResult.errorText,
        });
      }

      console.log("HTML file uploaded successfully");

      // Paso 3: Subir el archivo .env si se proporciona
      if (envContent) {
        console.log("Step 3: Uploading .env file...");
        const uploadEnvResult = await uploadFileGithub(
          accessToken,
          owner,
          createdRepoName,
          ".env",
          envContent,
          "Add environment configuration"
        );

        if (!uploadEnvResult.success) {
          console.warn(
            "Warning: Error uploading .env file:",
            uploadEnvResult.errorText
          );
          // No retornamos error, ya que el .env es opcional
        } else {
          console.log(".env file uploaded successfully");
        }
      }

      // Paso 4: Habilitar GitHub Pages
      console.log("Step 4: Enabling GitHub Pages...");
      const enablePagesResult = await enableGithubPages(
        accessToken,
        owner,
        createdRepoName,
        "main",
        "/"
      );

      if (!enablePagesResult.success) {
        return res.status(400).json({
          success: false,
          message:
            "Repository created and files uploaded, but error enabling GitHub Pages",
          error: enablePagesResult.errorText,
          repoUrl: createRepoResult.repoUrl,
        });
      }

      console.log("GitHub Pages enabled successfully");

      // Retornar el resultado exitoso
      return res.status(201).json({
        success: true,
        message:
          "Repository created and published to GitHub Pages successfully",
        repoUrl: createRepoResult.repoUrl,
        pagesUrl: enablePagesResult.pagesUrl,
        owner: owner,
        repoName: createdRepoName,
      });
    } catch (error) {
      console.error("Error in githubCreateAndPublish:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }
);

/**
 * Endpoint para eliminar un repositorio de GitHub
 * POST body:
 * - uid: ID del usuario
 * - repoName: Nombre del repositorio
 */
export const githubDeleteRepository = onRequest(
  { cors: true },
  async (req, res) => {
    // Permitir CORS para desarrollo local
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, DELETE");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const { uid, repoName } = req.body;

      // Validar parámetros requeridos
      if (!uid || !repoName) {
        return res.status(400).json({
          success: false,
          message: "Missing required parameters: uid or repoName",
        });
      }

      console.log("Deleting GitHub repo for user:", uid, "repo:", repoName);

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

      // Obtener el nombre de usuario (owner) desde la API de GitHub
      const userResponse = await fetch("https://api.github.com/user", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      const userData = await userResponse.json();

      if (!userResponse.ok) {
        return res.status(400).json({
          success: false,
          message: "Error getting GitHub user information",
          error: userData.message,
        });
      }

      const owner = userData.login;

      // Eliminar el repositorio
      const deleteResult = await deleteRepositoryGithub(
        accessToken,
        owner,
        repoName
      );

      if (!deleteResult.success) {
        return res.status(400).json({
          success: false,
          message: "Error deleting repository",
          error: deleteResult.errorText,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Repository deleted successfully",
      });
    } catch (error) {
      console.error("Error in githubDeleteRepository:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }
);

/**
 * Endpoint para obtener información de un repositorio de GitHub
 * GET query params:
 * - uid: ID del usuario
 * - repoName: Nombre del repositorio
 */
export const githubGetRepository = onRequest(
  { cors: true },
  async (req, res) => {
    // Permitir CORS para desarrollo local
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const { uid, repoName } = req.query;

      // Validar parámetros requeridos
      if (!uid || !repoName) {
        return res.status(400).json({
          success: false,
          message: "Missing required parameters: uid or repoName",
        });
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

      // Obtener el nombre de usuario (owner) desde la API de GitHub
      const userResponse = await fetch("https://api.github.com/user", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      const userData = await userResponse.json();

      if (!userResponse.ok) {
        return res.status(400).json({
          success: false,
          message: "Error getting GitHub user information",
          error: userData.message,
        });
      }

      const owner = userData.login;

      // Obtener información del repositorio
      const repoResult = await getRepositoryInfo(accessToken, owner, repoName);

      if (!repoResult.success) {
        return res.status(400).json({
          success: false,
          message: "Error getting repository information",
          error: repoResult.errorText,
        });
      }

      return res.status(200).json({
        success: true,
        repo: repoResult.repo,
      });
    } catch (error) {
      console.error("Error in githubGetRepository:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }
);

/**
 * Endpoint para actualizar el HTML de un repositorio existente en GitHub
 * POST body:
 * - uid: ID del usuario
 * - repoName: Nombre del repositorio
 * - htmlContent: Contenido del archivo HTML actualizado
 * - envContent: Contenido del archivo .env (opcional)
 */
export const githubUpdateHtml = onRequest({ cors: true }, async (req, res) => {
  // Permitir CORS para desarrollo local
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, PUT");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const { uid, repoName, htmlContent, envContent } = req.body;

    // Validar parámetros requeridos
    if (!uid || !repoName || !htmlContent) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: uid, repoName, or htmlContent",
      });
    }

    console.log("Updating GitHub repo HTML for user:", uid, "repo:", repoName);

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

    // Obtener el nombre de usuario (owner)
    const userResponse = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const userData = await userResponse.json();

    if (!userResponse.ok) {
      return res.status(400).json({
        success: false,
        message: "Error getting GitHub user information",
        error: userData.message,
      });
    }

    const owner = userData.login;

    // Paso 1: Actualizar el archivo index.html
    console.log("Updating index.html...");
    const uploadHtmlResult = await uploadFileGithub(
      accessToken,
      owner,
      repoName,
      "index.html",
      htmlContent,
      "Update experiment HTML"
    );

    if (!uploadHtmlResult.success) {
      return res.status(400).json({
        success: false,
        message: "Error uploading HTML file",
        error: uploadHtmlResult.errorText,
      });
    }

    console.log("HTML file updated successfully");

    // Paso 2: Actualizar el archivo .env si se proporciona
    if (envContent) {
      console.log("Updating .env file...");
      const uploadEnvResult = await uploadFileGithub(
        accessToken,
        owner,
        repoName,
        ".env",
        envContent,
        "Update environment configuration"
      );

      if (!uploadEnvResult.success) {
        console.warn(
          "Warning: Error uploading .env file:",
          uploadEnvResult.errorText
        );
        // No retornamos error, ya que el .env es opcional
      } else {
        console.log(".env file updated successfully");
      }
    }

    // Paso 3: Verificar que GitHub Pages esté habilitado
    console.log("Ensuring GitHub Pages is enabled...");
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
    return res.status(200).json({
      success: true,
      message: "Repository HTML updated successfully",
      repoUrl: `https://github.com/${owner}/${repoName}`,
      pagesUrl: pagesUrl,
      owner: owner,
      repoName: repoName,
    });
  } catch (error) {
    console.error("Error in githubUpdateHtml:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});
