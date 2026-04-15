import fetch from "node-fetch";

/**
 * Obtiene el nombre de usuario de GitHub
 * @param {string} accessToken - Token de acceso de GitHub
 * @returns {Promise<Object>} - Objeto con el resultado
 */
async function getGithubUsername(accessToken) {
  try {
    const response = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const userData = await response.json();

    if (!response.ok) {
      return {
        success: false,
        errorText: userData.message || "Error getting GitHub username",
        errorCode: response.status,
      };
    }

    return {
      success: true,
      username: userData.login,
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}

/**
 * Crea un nuevo repositorio en GitHub
 * @param {string} accessToken - Token de acceso de GitHub
 * @param {string} repoName - Nombre del repositorio
 * @param {boolean} isPrivate - Si el repositorio debe ser privado (default: false)
 * @param {string} description - Descripción del repositorio (opcional)
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function createRepositoryGithub(
  accessToken,
  repoName,
  isPrivate = false,
  description = "",
) {
  try {
    // Primero obtener el nombre de usuario
    const usernameResult = await getGithubUsername(accessToken);
    if (!usernameResult.success) {
      return usernameResult;
    }

    const username = usernameResult.username;

    // Verificar si el repositorio ya existe
    const checkResponse = await fetch(
      `https://api.github.com/repos/${username}/${repoName}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (checkResponse.ok) {
      // El repositorio ya existe
      return {
        success: true,
        repoUrl: `https://github.com/${username}/${repoName}`,
        repoName: repoName,
        owner: username,
        existed: true,
      };
    }

    // Crear el repositorio
    const createResponse = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: repoName,
        description: description,
        private: isPrivate,
        auto_init: true, // Inicializar con README
      }),
    });

    const createResult = await createResponse.json();

    if (!createResponse.ok) {
      return {
        success: false,
        errorText: createResult.message || "Error creating repository",
        errorCode: createResponse.status,
      };
    }

    return {
      success: true,
      repoUrl: createResult.html_url,
      repoName: createResult.name,
      owner: createResult.owner.login,
      existed: false,
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}

/**
 * Sube un archivo a un repositorio de GitHub
 * @param {string} accessToken - Token de acceso de GitHub
 * @param {string} owner - Propietario del repositorio
 * @param {string} repoName - Nombre del repositorio
 * @param {string} filePath - Ruta del archivo en el repositorio (ej: "index.html", "config/.env")
 * @param {string} content - Contenido del archivo (en texto plano)
 * @param {string} message - Mensaje del commit
 * @param {string} branch - Rama donde subir el archivo (default: "main")
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function uploadFileGithub(
  accessToken,
  owner,
  repoName,
  filePath,
  content,
  message = "Add file via API",
  branch = "main",
) {
  try {
    // Convertir el contenido a Base64
    const contentBase64 = Buffer.from(content).toString("base64");

    // Verificar si el archivo ya existe para obtener su SHA (necesario para actualizar)
    const checkResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}?ref=${branch}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    let sha = null;
    if (checkResponse.ok) {
      const fileData = await checkResponse.json();
      sha = fileData.sha;
    }

    // Crear o actualizar el archivo
    const uploadResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message,
          content: contentBase64,
          branch: branch,
          ...(sha && { sha: sha }), // Incluir SHA solo si el archivo existe
        }),
      },
    );

    const uploadResult = await uploadResponse.json();

    if (!uploadResponse.ok) {
      return {
        success: false,
        errorText: uploadResult.message || "Error uploading file",
        errorCode: uploadResponse.status,
      };
    }

    return {
      success: true,
      filePath: filePath,
      fileUrl: uploadResult.content.html_url,
      commit: uploadResult.commit.sha,
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}

/**
 * Habilita GitHub Pages para un repositorio
 * @param {string} accessToken - Token de acceso de GitHub
 * @param {string} owner - Propietario del repositorio
 * @param {string} repoName - Nombre del repositorio
 * @param {string} branch - Rama a publicar (default: "main")
 * @param {string} path - Ruta en la rama ("/" o "/docs", default: "/")
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function enableGithubPages(
  accessToken,
  owner,
  repoName,
  branch = "main",
  path = "/",
) {
  try {
    // Verificar si GitHub Pages ya está habilitado
    const checkResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pages`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (checkResponse.ok) {
      const pagesData = await checkResponse.json();
      return {
        success: true,
        pagesUrl: pagesData.html_url,
        existed: true,
      };
    }

    // Habilitar GitHub Pages
    const enableResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: {
            branch: branch,
            path: path,
          },
        }),
      },
    );

    const enableResult = await enableResponse.json();

    if (!enableResponse.ok && enableResponse.status !== 201) {
      return {
        success: false,
        errorText: enableResult.message || "Error enabling GitHub Pages",
        errorCode: enableResponse.status,
      };
    }

    // Esperar un momento para que GitHub Pages se configure
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Obtener la URL de GitHub Pages
    const pagesResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pages`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (pagesResponse.ok) {
      const pagesData = await pagesResponse.json();
      return {
        success: true,
        pagesUrl: pagesData.html_url,
        existed: false,
      };
    }

    // Si no podemos obtener la URL, retornar la URL estimada
    return {
      success: true,
      pagesUrl: `https://${owner}.github.io/${repoName}/`,
      existed: false,
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}

/**
 * Elimina un repositorio de GitHub
 * @param {string} accessToken - Token de acceso de GitHub
 * @param {string} owner - Propietario del repositorio
 * @param {string} repoName - Nombre del repositorio
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function deleteRepositoryGithub(accessToken, owner, repoName) {
  try {
    const deleteResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!deleteResponse.ok && deleteResponse.status !== 204) {
      const errorResult = await deleteResponse.json();
      return {
        success: false,
        errorText: errorResult.message || "Error deleting repository",
        errorCode: deleteResponse.status,
      };
    }

    return {
      success: true,
      message: "Repository deleted successfully",
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}

/**
 * Obtiene información de un repositorio
 * @param {string} accessToken - Token de acceso de GitHub
 * @param {string} owner - Propietario del repositorio
 * @param {string} repoName - Nombre del repositorio
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function getRepositoryInfo(accessToken, owner, repoName) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    const repoData = await response.json();

    if (!response.ok) {
      return {
        success: false,
        errorText: repoData.message || "Error getting repository info",
        errorCode: response.status,
      };
    }

    return {
      success: true,
      repo: {
        name: repoData.name,
        fullName: repoData.full_name,
        description: repoData.description,
        url: repoData.html_url,
        private: repoData.private,
        createdAt: repoData.created_at,
        updatedAt: repoData.updated_at,
      },
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}

export default {
  createRepositoryGithub,
  uploadFileGithub,
  enableGithubPages,
  deleteRepositoryGithub,
  getRepositoryInfo,
};
