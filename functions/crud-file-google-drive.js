import fetch from "node-fetch";

/**
 * Crea o encuentra una carpeta en Google Drive
 * @param {string} accessToken - Token de acceso de Google Drive
 * @param {string} folderName - Nombre de la carpeta
 * @param {string} parentFolderId - ID de la carpeta padre (opcional)
 * @returns {Promise<Object>} - Objeto con el resultado
 */
async function findOrCreateFolder(
  accessToken,
  folderName,
  parentFolderId = null
) {
  try {
    // Buscar si la carpeta ya existe
    let searchQuery = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentFolderId) {
      searchQuery += ` and '${parentFolderId}' in parents`;
    }

    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        searchQuery
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const searchResult = await searchResponse.json();

    if (searchResult.files && searchResult.files.length > 0) {
      // La carpeta ya existe
      return {
        success: true,
        folderId: searchResult.files[0].id,
        existed: true,
      };
    }

    // Crear la carpeta
    const metadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    };

    if (parentFolderId) {
      metadata.parents = [parentFolderId];
    }

    const createResponse = await fetch(
      "https://www.googleapis.com/drive/v3/files",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
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

    return {
      success: true,
      folderId: createResult.id,
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
 * Crea una estructura de carpetas en Google Drive
 * @param {string} accessToken - Token de acceso de Google Drive
 * @param {string} folderPath - Ruta de la carpeta (ej: "/ExpBuilder/ExperimentName")
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function createFolderGoogleDrive(accessToken, folderPath) {
  try {
    // Limpiar y dividir la ruta
    const parts = folderPath.split("/").filter((p) => p.length > 0);

    if (parts.length === 0) {
      return {
        success: false,
        errorText: "Invalid folder path",
      };
    }

    let currentParentId = null;

    // Crear cada carpeta en la jerarquía
    for (const folderName of parts) {
      const result = await findOrCreateFolder(
        accessToken,
        folderName,
        currentParentId
      );

      if (!result.success) {
        return result;
      }

      currentParentId = result.folderId;
    }

    return {
      success: true,
      folderId: currentParentId,
      message: "Folder created successfully",
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}

/**
 * Elimina una carpeta y todo su contenido en Google Drive
 * @param {string} accessToken - Token de acceso de Google Drive
 * @param {string} folderPath - Ruta de la carpeta (ej: "/ExpBuilder/ExperimentName")
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function deleteFolderGoogleDrive(accessToken, folderPath) {
  try {
    // Buscar la carpeta por su ruta
    const parts = folderPath.split("/").filter((p) => p.length > 0);

    if (parts.length === 0) {
      return {
        success: false,
        errorText: "Invalid folder path",
      };
    }

    let currentParentId = null;
    let targetFolderId = null;

    // Navegar por la jerarquía de carpetas
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
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const searchResult = await searchResponse.json();

      if (!searchResult.files || searchResult.files.length === 0) {
        // La carpeta no existe
        return {
          success: true,
          message: "Folder does not exist",
        };
      }

      currentParentId = searchResult.files[0].id;
      targetFolderId = currentParentId;
    }

    // Eliminar la carpeta encontrada
    if (targetFolderId) {
      const deleteResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${targetFolderId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
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

      return {
        success: true,
        message: "Folder deleted successfully",
      };
    }

    return {
      success: false,
      errorText: "Folder not found",
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}

/**
 * Crea una nueva sesión en Google Drive como archivo CSV
 * @param {string} driveFolderId - ID de la carpeta en Google Drive
 * @param {string} driveToken - Token de acceso de Google Drive
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function createSessionGoogleDrive(
  driveFolderId,
  driveToken,
  experimentID,
  sessionId
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  // Verificar si el archivo ya existe
  const searchQuery = `name='${fileName}' and '${driveFolderId}' in parents and trashed=false`;
  const checkResult = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      searchQuery
    )}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${driveToken}`,
      },
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

  // Crear archivo CSV vacío (sin encabezados porque aún no sabemos las columnas)
  const initialCSV = "";

  const metadata = {
    name: fileName,
    mimeType: "text/csv",
    parents: [driveFolderId],
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
        Authorization: `Bearer ${driveToken}`,
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

  return {
    success: true,
    id: result.id,
    participantNumber: 1,
  };
}

/**
 * Agrega una fila CSV a una sesión existente en Google Drive
 * @param {string} driveFolderId - ID de la carpeta en Google Drive
 * @param {string} driveToken - Token de acceso de Google Drive
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @param {string} csvRow - Fila CSV a agregar (ya viene como string CSV desde api-data.js)
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function appendResultGoogleDrive(
  driveFolderId,
  driveToken,
  experimentID,
  sessionId,
  csvRow
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  // Buscar el archivo
  const searchQuery = `name='${fileName}' and '${driveFolderId}' in parents and trashed=false`;
  const searchResult = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      searchQuery
    )}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${driveToken}`,
      },
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

  // Descargar el archivo CSV existente
  const downloadResult = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${driveToken}`,
      },
    }
  );

  if (!downloadResult.ok) {
    return {
      success: false,
      errorText: "Error downloading file",
      errorCode: downloadResult.status,
    };
  }

  let existingCSV = await downloadResult.text();

  // Si el archivo está vacío, la primera línea CSV será el encabezado
  // Si ya tiene contenido, agregamos una nueva línea
  let updatedCSV;
  if (existingCSV.trim() === "") {
    // Primer registro: csvRow ya incluye el encabezado
    updatedCSV = csvRow;
  } else {
    // Registros subsecuentes: agregar nueva línea
    updatedCSV = existingCSV + "\n" + csvRow;
  }

  // Actualizar el archivo en Drive
  const uploadResult = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${driveToken}`,
        "Content-Type": "text/csv",
      },
      body: updatedCSV,
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

  return {
    success: true,
    id: fileId,
    participantNumber: 1,
  };
}

/**
 * Lista todas las sesiones de un experimento en Google Drive
 * @param {string} driveFolderId - ID de la carpeta en Google Drive
 * @param {string} driveToken - Token de acceso de Google Drive
 * @param {string} experimentID - ID del experimento
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function listSessionsGoogleDrive(
  driveFolderId,
  driveToken,
  experimentID
) {
  const searchQuery = `'${driveFolderId}' in parents and trashed=false and name contains '${experimentID}_'`;

  const listResult = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      searchQuery
    )}&fields=files(id,name,createdTime,modifiedTime)`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${driveToken}`,
      },
    }
  );

  if (!listResult.ok) {
    const errorResult = await listResult.json();
    return {
      success: false,
      errorText: errorResult.error?.message || "Error listing sessions",
      errorCode: listResult.status,
    };
  }

  const result = await listResult.json();

  // Filtrar y mapear las sesiones
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

  return {
    success: true,
    sessions,
  };
}

/**
 * Descarga los datos de una sesión como CSV
 * @param {string} driveFolderId - ID de la carpeta en Google Drive
 * @param {string} driveToken - Token de acceso de Google Drive
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function downloadSessionGoogleDrive(
  driveFolderId,
  driveToken,
  experimentID,
  sessionId
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  // Buscar el archivo
  const searchQuery = `name='${fileName}' and '${driveFolderId}' in parents and trashed=false`;
  const searchResult = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      searchQuery
    )}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${driveToken}`,
      },
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

  // Descargar el archivo CSV directamente
  const downloadResult = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${driveToken}`,
      },
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

  return {
    success: true,
    csv,
  };
}

/**
 * Elimina una sesión en Google Drive
 * @param {string} driveFolderId - ID de la carpeta en Google Drive
 * @param {string} driveToken - Token de acceso de Google Drive
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export async function deleteSessionGoogleDrive(
  driveFolderId,
  driveToken,
  experimentID,
  sessionId
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  // Buscar el archivo
  const searchQuery = `name='${fileName}' and '${driveFolderId}' in parents and trashed=false`;
  const searchResult = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      searchQuery
    )}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${driveToken}`,
      },
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
      headers: {
        Authorization: `Bearer ${driveToken}`,
      },
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

  return {
    success: true,
    message: "Session deleted successfully",
  };
}

/**
 * Función original para subir un archivo completo a Google Drive
 * @param {string} driveFolderId - ID de la carpeta en Google Drive
 * @param {string} driveToken - Token de acceso de Google Drive
 * @param {string} filedata - Contenido del archivo
 * @param {string} filename - Nombre del archivo
 * @returns {Promise<Object>} - Objeto con el resultado
 */
export default async function postFileGoogleDrive(
  driveFolderId,
  driveToken,
  filedata,
  filename
) {
  try {
    const metadata = {
      name: filename,
      mimeType: "application/json",
      parents: [driveFolderId],
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
          Authorization: `Bearer ${driveToken}`,
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

    return {
      success: true,
      id: result.id,
    };
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}
