import fetch from "node-fetch";

/**
 * Crea una carpeta en el proveedor de almacenamiento
 * @param {string} provider - Proveedor ('dropbox' o 'googledrive')
 * @param {string} token - Token de acceso
 * @param {string} folderPath - Ruta de la carpeta
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function createFolder(provider, token, folderPath) {
  try {
    if (provider === "dropbox") {
      const response = await fetch(
        "https://api.dropboxapi.com/2/files/create_folder_v2",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path: folderPath,
            autorename: false,
          }),
        }
      );

      const result = await response.json();

      if (response.status === 200) {
        return { success: true, metadata: result.metadata };
      } else if (
        response.status === 409 &&
        result.error?.[".tag"] === "path" &&
        result.error.path?.[".tag"] === "conflict"
      ) {
        return { success: true, alreadyExists: true };
      } else {
        return {
          success: false,
          errorCode: response.status,
          errorText: result.error_summary || response.statusText,
        };
      }
    } else if (provider === "googledrive") {
      const parts = folderPath.split("/").filter((p) => p.length > 0);
      if (parts.length === 0) {
        return { success: false, errorText: "Invalid folder path" };
      }

      let currentParentId = null;
      for (const folderName of parts) {
        // Buscar si la carpeta ya existe
        let searchQuery = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        if (currentParentId) {
          searchQuery += ` and '${currentParentId}' in parents`;
        }

        const searchResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
            searchQuery
          )}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        const searchResult = await searchResponse.json();

        if (searchResult.files && searchResult.files.length > 0) {
          currentParentId = searchResult.files[0].id;
        } else {
          // Crear la carpeta
          const metadata = {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
          };
          if (currentParentId) {
            metadata.parents = [currentParentId];
          }

          const createResponse = await fetch(
            "https://www.googleapis.com/drive/v3/files",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(metadata),
            }
          );

          const createResult = await createResponse.json();
          if (!createResponse.ok) {
            return {
              success: false,
              errorText: createResult.error?.message || "Error creating folder",
              errorCode: createResponse.status,
            };
          }
          currentParentId = createResult.id;
        }
      }

      return {
        success: true,
        folderId: currentParentId,
        message: "Folder created successfully",
      };
    }

    return { success: false, errorText: "Unknown provider" };
  } catch (error) {
    return { success: false, errorText: error.message };
  }
}

/**
 * Elimina una carpeta en el proveedor de almacenamiento
 * @param {string} provider - Proveedor ('dropbox' o 'googledrive')
 * @param {string} token - Token de acceso
 * @param {string} folderPath - Ruta de la carpeta
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function deleteFolder(provider, token, folderPath) {
  try {
    if (provider === "dropbox") {
      const response = await fetch(
        "https://api.dropboxapi.com/2/files/delete_v2",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: folderPath }),
        }
      );

      const result = await response.json();
      if (response.status === 200) {
        return { success: true, metadata: result.metadata };
      } else {
        return {
          success: false,
          errorCode: response.status,
          errorText: result.error_summary || response.statusText,
        };
      }
    } else if (provider === "googledrive") {
      const parts = folderPath.split("/").filter((p) => p.length > 0);
      if (parts.length === 0) {
        return { success: false, errorText: "Invalid folder path" };
      }

      let currentParentId = null;
      let targetFolderId = null;

      for (const folderName of parts) {
        let searchQuery = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        if (currentParentId) {
          searchQuery += ` and '${currentParentId}' in parents`;
        }

        const searchResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
            searchQuery
          )}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        const searchResult = await searchResponse.json();
        if (!searchResult.files || searchResult.files.length === 0) {
          return { success: true, message: "Folder does not exist" };
        }

        currentParentId = searchResult.files[0].id;
        targetFolderId = currentParentId;
      }

      if (targetFolderId) {
        const deleteResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${targetFolderId}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (!deleteResponse.ok) {
          const errorResult = await deleteResponse.json();
          return {
            success: false,
            errorText: errorResult.error?.message || "Error deleting folder",
            errorCode: deleteResponse.status,
          };
        }
        return { success: true, message: "Folder deleted successfully" };
      }

      return { success: false, errorText: "Folder not found" };
    }

    return { success: false, errorText: "Unknown provider" };
  } catch (error) {
    return { success: false, errorText: error.message };
  }
}

/**
 * Crea una nueva sesión (archivo CSV)
 * @param {string} provider - Proveedor ('dropbox' o 'googledrive')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox) o ID (googledrive)
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function createSession(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
  const initialCSV = "";

  if (provider === "dropbox") {
    const filePath = `${folderIdentifier}/${fileName}`;

    // Verificar si existe
    const checkResult = await fetch(
      "https://api.dropboxapi.com/2/files/get_metadata",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: filePath }),
      }
    );

    if (checkResult.status === 200) {
      return { success: false, error: "Session already exists" };
    }

    // Crear archivo
    const uploadResult = await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: filePath,
            mode: "add",
            autorename: false,
            mute: false,
          }),
          "Content-Type": "application/octet-stream",
        },
        body: initialCSV,
      }
    );

    if (uploadResult.status !== 200) {
      const result = await uploadResult.json().catch(() => ({}));
      return {
        success: false,
        errorCode: uploadResult.status,
        errorText: result.error_summary || uploadResult.statusText,
      };
    }

    const result = await uploadResult.json();
    return { success: true, id: result.id, participantNumber: 1 };
  } else if (provider === "googledrive") {
    // Verificar si existe
    const searchQuery = `name='${fileName}' and '${folderIdentifier}' in parents and trashed=false`;
    const checkResult = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        searchQuery
      )}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const checkData = await checkResult.json();
    if (checkData.files && checkData.files.length > 0) {
      return {
        success: false,
        errorText: "Session already exists",
        errorCode: 409,
      };
    }

    // Crear archivo
    const metadata = {
      name: fileName,
      mimeType: "text/csv",
      parents: [folderIdentifier],
    };

    const boundary = "-------314159265358979323846";
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: text/csv\r\n\r\n" +
      initialCSV +
      close_delim;

    const uploadResult = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    const result = await uploadResult.json();
    if (!uploadResult.ok) {
      return {
        success: false,
        errorText: result.error?.message || "Error creating session",
        errorCode: uploadResult.status,
      };
    }

    return { success: true, id: result.id, participantNumber: 1 };
  }

  return { success: false, errorText: "Unknown provider" };
}

/**
 * Agrega/actualiza datos en una sesión existente
 * @param {string} provider - Proveedor ('dropbox' o 'googledrive')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox) o ID (googledrive)
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @param {string} csvContent - Contenido CSV a guardar
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function appendResult(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
  csvContent
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  if (provider === "dropbox") {
    const filePath = `${folderIdentifier}/${fileName}`;

    const uploadResult = await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: filePath,
            mode: "overwrite",
            autorename: false,
            mute: false,
          }),
          "Content-Type": "application/octet-stream",
        },
        body: csvContent,
      }
    );

    if (uploadResult.status !== 200) {
      const result = await uploadResult.json().catch(() => ({}));
      return {
        success: false,
        errorCode: uploadResult.status,
        errorText: result.error_summary || uploadResult.statusText,
      };
    }

    const result = await uploadResult.json();
    return { success: true, id: result.id, participantNumber: 1 };
  } else if (provider === "googledrive") {
    // Buscar el archivo
    const searchQuery = `name='${fileName}' and '${folderIdentifier}' in parents and trashed=false`;
    const searchResult = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        searchQuery
      )}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const searchData = await searchResult.json();
    if (!searchData.files || searchData.files.length === 0) {
      return {
        success: false,
        errorText: "Session not found",
        errorCode: 404,
      };
    }

    const fileId = searchData.files[0].id;

    // Actualizar el archivo
    const uploadResult = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/csv",
        },
        body: csvContent,
      }
    );

    if (!uploadResult.ok) {
      const result = await uploadResult.json();
      return {
        success: false,
        errorText: result.error?.message || "Error updating file",
        errorCode: uploadResult.status,
      };
    }

    return { success: true, id: fileId, participantNumber: 1 };
  }

  return { success: false, errorText: "Unknown provider" };
}

/**
 * Lista todas las sesiones de un experimento
 * @param {string} provider - Proveedor ('dropbox' o 'googledrive')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox) o ID (googledrive)
 * @param {string} experimentID - ID del experimento
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function listSessions(
  provider,
  token,
  folderIdentifier,
  experimentID
) {
  if (provider === "dropbox") {
    const listResult = await fetch(
      "https://api.dropboxapi.com/2/files/list_folder",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: folderIdentifier,
          recursive: false,
        }),
      }
    );

    if (listResult.status !== 200) {
      const result = await listResult.json().catch(() => ({}));
      return {
        success: false,
        errorCode: listResult.status,
        errorText: result.error_summary || listResult.statusText,
        sessions: [],
      };
    }

    const result = await listResult.json();
    const sessions = result.entries
      .filter(
        (entry) =>
          entry[".tag"] === "file" &&
          entry.name.startsWith(`${experimentID}_`) &&
          entry.name.endsWith(".csv")
      )
      .map((entry) => {
        const sessionId = entry.name
          .replace(`${experimentID}_`, "")
          .replace(".csv", "");
        return {
          sessionId,
          experimentID,
          createdAt: entry.server_modified,
          name: entry.name,
          path: entry.path_display,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { success: true, sessions };
  } else if (provider === "googledrive") {
    const searchQuery = `'${folderIdentifier}' in parents and trashed=false and name contains '${experimentID}_'`;

    const listResult = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        searchQuery
      )}&fields=files(id,name,createdTime,modifiedTime)`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!listResult.ok) {
      const errorResult = await listResult.json();
      return {
        success: false,
        errorText: errorResult.error?.message || "Error listing sessions",
        errorCode: listResult.status,
        sessions: [],
      };
    }

    const result = await listResult.json();
    const sessions = result.files
      .filter((file) => file.name.endsWith(".csv"))
      .map((file) => {
        const sessionId = file.name
          .replace(`${experimentID}_`, "")
          .replace(".csv", "");
        return {
          sessionId,
          fileId: file.id,
          fileName: file.name,
          createdAt: file.createdTime,
          modifiedAt: file.modifiedTime,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { success: true, sessions };
  }

  return { success: false, errorText: "Unknown provider", sessions: [] };
}

/**
 * Descarga los datos de una sesión
 * @param {string} provider - Proveedor ('dropbox' o 'googledrive')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox) o ID (googledrive)
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Resultado de la operación con el CSV
 */
export async function downloadSession(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  if (provider === "dropbox") {
    const filePath = `${folderIdentifier}/${fileName}`;

    const downloadResult = await fetch(
      "https://content.dropboxapi.com/2/files/download",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
        },
      }
    );

    if (downloadResult.status !== 200) {
      return { success: false, error: "Session not found" };
    }

    const csv = await downloadResult.text();
    return { success: true, csv, filename: fileName };
  } else if (provider === "googledrive") {
    // Buscar el archivo
    const searchQuery = `name='${fileName}' and '${folderIdentifier}' in parents and trashed=false`;
    const searchResult = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        searchQuery
      )}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const searchData = await searchResult.json();
    if (!searchData.files || searchData.files.length === 0) {
      return {
        success: false,
        errorText: "Session not found",
        errorCode: 404,
      };
    }

    const fileId = searchData.files[0].id;

    // Descargar el archivo
    const downloadResult = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!downloadResult.ok) {
      return {
        success: false,
        errorText: "Error downloading file",
        errorCode: downloadResult.status,
      };
    }

    const csv = await downloadResult.text();
    return { success: true, csv };
  }

  return { success: false, errorText: "Unknown provider" };
}

/**
 * Elimina una sesión
 * @param {string} provider - Proveedor ('dropbox' o 'googledrive')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox) o ID (googledrive)
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function deleteSession(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  if (provider === "dropbox") {
    const filePath = `${folderIdentifier}/${fileName}`;

    const deleteResult = await fetch(
      "https://api.dropboxapi.com/2/files/delete_v2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: filePath }),
      }
    );

    if (deleteResult.status !== 200) {
      const result = await deleteResult.json().catch(() => ({}));
      return {
        success: false,
        errorCode: deleteResult.status,
        errorText: result.error_summary || deleteResult.statusText,
      };
    }

    return { success: true };
  } else if (provider === "googledrive") {
    // Buscar el archivo
    const searchQuery = `name='${fileName}' and '${folderIdentifier}' in parents and trashed=false`;
    const searchResult = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        searchQuery
      )}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const searchData = await searchResult.json();
    if (!searchData.files || searchData.files.length === 0) {
      return {
        success: false,
        errorText: "Session not found",
        errorCode: 404,
      };
    }

    const fileId = searchData.files[0].id;

    // Eliminar el archivo
    const deleteResult = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!deleteResult.ok) {
      const errorResult = await deleteResult.json();
      return {
        success: false,
        errorText: errorResult.error?.message || "Error deleting session",
        errorCode: deleteResult.status,
      };
    }

    return { success: true, message: "Session deleted successfully" };
  }

  return { success: false, errorText: "Unknown provider" };
}

/**
 * Guarda un archivo completo en el proveedor (función legacy)
 * @param {string} provider - Proveedor ('dropbox' o 'googledrive')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox) o ID (googledrive)
 * @param {string} filedata - Contenido del archivo
 * @param {string} filename - Nombre del archivo
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function postFile(
  provider,
  token,
  folderIdentifier,
  filedata,
  filename
) {
  if (provider === "dropbox") {
    const filePath = `${folderIdentifier}/${filename}`;

    const result = await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: filePath,
            mode: "overwrite",
            autorename: false,
            mute: false,
          }),
          "Content-Type": "application/octet-stream",
        },
        body: filedata,
      }
    );

    if (result.status !== 200) {
      const data = await result.json().catch(() => ({}));
      return {
        success: false,
        errorCode: result.status,
        errorText: data.error_summary || result.statusText,
      };
    }

    return { success: true, errorCode: null, errorText: null };
  } else if (provider === "googledrive") {
    const metadata = {
      name: filename,
      mimeType: "application/json",
      parents: [folderIdentifier],
    };

    const boundary = "-------314159265358979323846";
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      filedata +
      close_delim;

    const uploadResult = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    const result = await uploadResult.json();
    if (!uploadResult.ok) {
      return {
        success: false,
        errorText: result.error?.message || "Error uploading file",
        errorCode: uploadResult.status,
      };
    }

    return { success: true, id: result.id };
  }

  return { success: false, errorText: "Unknown provider" };
}
