import fetch from "node-fetch";

/**
 * Crea una nueva sesión (archivo CSV)
 * @param {string} provider - Proveedor ('dropbox', 'googledrive', o 'osf')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox), ID (googledrive), o uploadLink (osf)
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function createSession(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
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
      },
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
      },
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
        searchQuery,
      )}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
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
      },
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
  } else if (provider === "osf") {
    // Para OSF, folderIdentifier es el uploadLink del componente
    const uploadLink = folderIdentifier;

    const queryParams = new URLSearchParams({
      type: "files",
      name: fileName,
    });

    const uploadUrl = `${uploadLink}?${queryParams.toString()}`;

    const uploadResult = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "text/csv",
        Authorization: `Bearer ${token}`,
      },
      body: initialCSV,
    });

    if (!uploadResult.ok) {
      const errorText = await uploadResult.text();
      return {
        success: false,
        errorText: errorText || "Error creating session",
        errorCode: uploadResult.status,
      };
    }

    const result = await uploadResult.json();
    return { success: true, id: result.data?.id, participantNumber: 1 };
  }

  return { success: false, errorText: "Unknown provider" };
}

/**
 * Agrega/actualiza datos en una sesión existente
 * @param {string} provider - Proveedor ('dropbox', 'googledrive', o 'osf')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox), ID (googledrive), o uploadLink (osf)
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
  csvContent,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  if (provider === "dropbox") {
    // Dropbox con mode: "overwrite" crea el archivo si no existe
    // o lo sobrescribe si ya existe (batch=0 mode - igual que OSF)
    const filePath = `${folderIdentifier}/${fileName}`;

    const uploadResult = await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: filePath,
            mode: "overwrite", // Crea si no existe, sobrescribe si existe
            autorename: false,
            mute: false,
          }),
          "Content-Type": "application/octet-stream",
        },
        body: csvContent,
      },
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
    // Buscar el archivo existente
    const searchQuery = `name='${fileName}' and '${folderIdentifier}' in parents and trashed=false`;
    const searchResult = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        searchQuery,
      )}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const searchData = await searchResult.json();

    if (!searchData.files || searchData.files.length === 0) {
      // Archivo no existe, crearlo (batch=0 mode - igual que OSF)
      console.log(`Drive: Creating new file ${fileName} (batch=0 mode)`);

      const metadata = {
        name: fileName,
        mimeType: "text/csv",
        parents: [folderIdentifier],
      };

      const createResponse = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/related; boundary=foo_bar_baz",
          },
          body:
            "--foo_bar_baz\r\n" +
            "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
            JSON.stringify(metadata) +
            "\r\n--foo_bar_baz\r\n" +
            "Content-Type: text/csv\r\n\r\n" +
            csvContent +
            "\r\n--foo_bar_baz--",
        },
      );

      if (!createResponse.ok) {
        const result = await createResponse.json();
        return {
          success: false,
          errorText: result.error?.message || "Error creating file",
          errorCode: createResponse.status,
        };
      }

      const createResult = await createResponse.json();
      return { success: true, id: createResult.id, participantNumber: 1 };
    }

    const fileId = searchData.files[0].id;

    // Archivo existe, actualizarlo (PATCH mode para batch>0)
    const uploadResult = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/csv",
        },
        body: csvContent,
      },
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
  } else if (provider === "osf") {
    // Para OSF, necesitamos eliminar el archivo existente (si existe) y crear uno nuevo
    // OSF no permite sobrescribir archivos
    const uploadLink = folderIdentifier;

    // Primero, intentar encontrar y eliminar el archivo existente
    try {
      // Extraer el componentId del uploadLink
      // uploadLink tiene formato: https://files.osf.io/v1/resources/{componentId}/providers/osfstorage/
      const componentIdMatch = uploadLink.match(/\/resources\/([^\/]+)\//);
      if (componentIdMatch) {
        const componentId = componentIdMatch[1];

        // Listar archivos para encontrar el existente
        const filesLink = `https://api.osf.io/v2/nodes/${componentId}/files/osfstorage/`;
        const filesResponse = await fetch(filesLink, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });

        if (filesResponse.ok) {
          const filesData = await filesResponse.json();
          const existingFile = filesData.data.find(
            (file) => file.attributes.name === fileName,
          );

          if (existingFile) {
            console.log(`OSF: Deleting existing file ${fileName}`);
            const deleteLink = existingFile.links.delete;
            await fetch(deleteLink, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
      }
    } catch (error) {
      console.log(
        "OSF: No existing file to delete or error deleting:",
        error.message,
      );
    }

    // Ahora crear el archivo nuevo
    const queryParams = new URLSearchParams({
      type: "files",
      name: fileName,
    });

    const uploadUrl = `${uploadLink}?${queryParams.toString()}`;

    const uploadResult = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "text/csv",
        Authorization: `Bearer ${token}`,
      },
      body: csvContent,
    });

    if (!uploadResult.ok) {
      const errorText = await uploadResult.text();
      return {
        success: false,
        errorText: errorText || "Error creating session file",
        errorCode: uploadResult.status,
      };
    }

    const result = await uploadResult.json();
    return { success: true, id: result.data?.id, participantNumber: 1 };
  }

  return { success: false, errorText: "Unknown provider" };
}

/**
 * Lista todas las sesiones de un experimento
 * @param {string} provider - Proveedor ('dropbox', 'googledrive', o 'osf')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox), ID (googledrive), o component ID (osf)
 * @param {string} experimentID - ID del experimento
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function listSessions(
  provider,
  token,
  folderIdentifier,
  experimentID,
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
      },
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
          entry.name.endsWith(".csv"),
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
        searchQuery,
      )}&fields=files(id,name,createdTime,modifiedTime)`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
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
  } else if (provider === "osf") {
    // Para OSF, necesitamos listar archivos del componente
    const componentId = folderIdentifier;

    // Primero obtener el storage provider del componente
    const nodeResponse = await fetch(
      `https://api.osf.io/v2/nodes/${componentId}/files/`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!nodeResponse.ok) {
      return {
        success: false,
        errorText: "Error accessing OSF component",
        errorCode: nodeResponse.status,
        sessions: [],
      };
    }

    const nodeData = await nodeResponse.json();
    const storageProvider = nodeData.data.find(
      (p) => p.attributes.name === "osfstorage",
    );

    if (!storageProvider) {
      return { success: true, sessions: [] };
    }

    // Obtener los archivos del storage provider
    const filesLink = storageProvider.relationships.files.links.related.href;
    const filesResponse = await fetch(filesLink, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!filesResponse.ok) {
      return {
        success: false,
        errorText: "Error listing files",
        errorCode: filesResponse.status,
        sessions: [],
      };
    }

    const filesData = await filesResponse.json();
    const sessions = filesData.data
      .filter(
        (file) =>
          file.attributes.kind === "file" &&
          file.attributes.name.startsWith(`${experimentID}_`) &&
          file.attributes.name.endsWith(".csv"),
      )
      .map((file) => {
        const sessionId = file.attributes.name
          .replace(`${experimentID}_`, "")
          .replace(".csv", "");
        return {
          sessionId,
          fileId: file.id,
          fileName: file.attributes.name,
          createdAt: file.attributes.date_created,
          modifiedAt: file.attributes.date_modified,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { success: true, sessions };
  }

  return { success: false, errorText: "Unknown provider", sessions: [] };
}

/**
 * Descarga los datos de una sesión
 * @param {string} provider - Proveedor ('dropbox', 'googledrive', o 'osf')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox), ID (googledrive), o component ID (osf)
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Resultado de la operación con el CSV
 */
export async function downloadSession(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
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
      },
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
        searchQuery,
      )}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
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
      },
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
  } else if (provider === "osf") {
    // Para OSF, buscar el archivo en el componente
    const componentId = folderIdentifier;

    // Obtener storage provider
    const nodeResponse = await fetch(
      `https://api.osf.io/v2/nodes/${componentId}/files/`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!nodeResponse.ok) {
      return {
        success: false,
        errorText: "Error accessing OSF component",
        errorCode: nodeResponse.status,
      };
    }

    const nodeData = await nodeResponse.json();
    const storageProvider = nodeData.data.find(
      (p) => p.attributes.name === "osfstorage",
    );

    if (!storageProvider) {
      return { success: false, errorText: "Storage provider not found" };
    }

    // Obtener los archivos
    const filesLink = storageProvider.relationships.files.links.related.href;
    const filesResponse = await fetch(filesLink, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!filesResponse.ok) {
      return {
        success: false,
        errorText: "Error listing files",
        errorCode: filesResponse.status,
      };
    }

    const filesData = await filesResponse.json();
    const targetFile = filesData.data.find(
      (f) => f.attributes.name === fileName,
    );

    if (!targetFile) {
      return { success: false, errorText: "Session not found" };
    }

    // Descargar el archivo
    const downloadLink = targetFile.links.download;
    const downloadResponse = await fetch(downloadLink, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!downloadResponse.ok) {
      return {
        success: false,
        errorText: "Error downloading file",
        errorCode: downloadResponse.status,
      };
    }

    const csv = await downloadResponse.text();
    return { success: true, csv, filename: fileName };
  }

  return { success: false, errorText: "Unknown provider" };
}

/**
 * Elimina una sesión
 * @param {string} provider - Proveedor ('dropbox', 'googledrive', o 'osf')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox), ID (googledrive), o component ID (osf)
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function deleteSession(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
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
      },
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
        searchQuery,
      )}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
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
      },
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
  } else if (provider === "osf") {
    // Para OSF, buscar y eliminar el archivo
    const componentId = folderIdentifier;

    // Obtener storage provider
    const nodeResponse = await fetch(
      `https://api.osf.io/v2/nodes/${componentId}/files/`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!nodeResponse.ok) {
      return {
        success: false,
        errorText: "Error accessing OSF component",
        errorCode: nodeResponse.status,
      };
    }

    const nodeData = await nodeResponse.json();
    const storageProvider = nodeData.data.find(
      (p) => p.attributes.name === "osfstorage",
    );

    if (!storageProvider) {
      return { success: false, errorText: "Storage provider not found" };
    }

    // Obtener los archivos
    const filesLink = storageProvider.relationships.files.links.related.href;
    const filesResponse = await fetch(filesLink, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!filesResponse.ok) {
      return {
        success: false,
        errorText: "Error listing files",
        errorCode: filesResponse.status,
      };
    }

    const filesData = await filesResponse.json();
    const targetFile = filesData.data.find(
      (f) => f.attributes.name === fileName,
    );

    if (!targetFile) {
      return { success: false, errorText: "Session not found", errorCode: 404 };
    }

    // Eliminar el archivo
    const deleteLink = targetFile.links.delete;
    const deleteResponse = await fetch(deleteLink, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!deleteResponse.ok) {
      return {
        success: false,
        errorText: "Error deleting file",
        errorCode: deleteResponse.status,
      };
    }

    return { success: true, message: "Session deleted successfully" };
  }

  return { success: false, errorText: "Unknown provider" };
}

/**
 * Guarda un archivo completo en el proveedor (función legacy)
 * @param {string} provider - Proveedor ('dropbox', 'googledrive', o 'osf')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox), ID (googledrive), o uploadLink (osf)
 * @param {string} filedata - Contenido del archivo
 * @param {string} filename - Nombre del archivo
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function postFile(
  provider,
  token,
  folderIdentifier,
  filedata,
  filename,
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
      },
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
      },
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
  } else if (provider === "osf") {
    // Para OSF, folderIdentifier es el uploadLink
    const uploadLink = folderIdentifier;

    const queryParams = new URLSearchParams({
      type: "files",
      name: filename,
    });

    const uploadUrl = `${uploadLink}?${queryParams.toString()}`;

    const uploadResult = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: filedata,
    });

    if (!uploadResult.ok) {
      const errorText = await uploadResult.text();
      return {
        success: false,
        errorText: errorText || "Error uploading file",
        errorCode: uploadResult.status,
      };
    }

    const result = await uploadResult.json();
    return {
      success: true,
      id: result.data?.id,
      errorCode: null,
      errorText: null,
    };
  }

  return { success: false, errorText: "Unknown provider" };
}
