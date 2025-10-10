import fetch from "node-fetch";

// Función para crear una nueva sesión en Dropbox
export async function createSessionDropbox(
  dropboxFolder,
  dropboxToken,
  experimentID,
  sessionId
) {
  const filePath = `${dropboxFolder}/${experimentID}_${sessionId}.json`;

  // Verificar si el archivo ya existe
  const checkResult = await fetch(
    "https://api.dropboxapi.com/2/files/get_metadata",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: filePath,
      }),
    }
  );

  if (checkResult.status === 200) {
    return {
      success: false,
      error: "Session already exists",
    };
  }

  // Crear archivo inicial con estructura básica
  const initialData = {
    experimentID,
    sessionId,
    createdAt: new Date().toISOString(),
    data: [],
  };

  const uploadResult = await fetch(
    "https://content.dropboxapi.com/2/files/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxToken}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: filePath,
          mode: "add",
          autorename: false,
          mute: false,
        }),
        "Content-Type": "application/octet-stream",
      },
      body: JSON.stringify(initialData),
    }
  );

  if (uploadResult.status !== 200) {
    let errorText = uploadResult.statusText;
    try {
      const result = await uploadResult.json();
      errorText = result.error_summary || uploadResult.statusText;
    } catch (err) {
      // Si no se puede parsear el JSON, usar el statusText
    }
    return {
      success: false,
      errorCode: uploadResult.status,
      errorText: errorText,
    };
  }

  let result;
  try {
    result = await uploadResult.json();
  } catch (err) {
    return {
      success: false,
      error: "Failed to parse response from Dropbox",
      details: err.message,
    };
  }

  return {
    success: true,
    id: result.id,
    participantNumber: 1, // Se debe calcular listando todos los archivos
  };
}

// Función para agregar respuestas a una sesión existente en Dropbox
export async function appendResultDropbox(
  dropboxFolder,
  dropboxToken,
  experimentID,
  sessionId,
  response
) {
  const filePath = `${dropboxFolder}/${experimentID}_${sessionId}.json`;

  // Descargar el archivo existente
  const downloadResult = await fetch(
    "https://content.dropboxapi.com/2/files/download",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxToken}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: filePath,
        }),
      },
    }
  );

  if (downloadResult.status !== 200) {
    return {
      success: false,
      error: "Session not found",
    };
  }

  const fileContent = await downloadResult.text();
  let sessionData;

  try {
    sessionData = JSON.parse(fileContent);
  } catch (err) {
    return {
      success: false,
      error: "Invalid JSON in session file",
    };
  }

  // Parsear response si es string
  if (typeof response === "string") {
    try {
      response = JSON.parse(response);
    } catch (err) {
      return {
        success: false,
        error: "Invalid response format",
      };
    }
  }

  // Agregar la nueva respuesta
  sessionData.data.push(response);

  // Subir el archivo actualizado
  const uploadResult = await fetch(
    "https://content.dropboxapi.com/2/files/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxToken}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: filePath,
          mode: "overwrite",
          autorename: false,
          mute: false,
        }),
        "Content-Type": "application/octet-stream",
      },
      body: JSON.stringify(sessionData),
    }
  );

  if (uploadResult.status !== 200) {
    let errorText = uploadResult.statusText;
    try {
      const result = await uploadResult.json();
      errorText = result.error_summary || uploadResult.statusText;
    } catch (err) {
      // Si no se puede parsear el JSON, usar el statusText
    }
    return {
      success: false,
      errorCode: uploadResult.status,
      errorText: errorText,
    };
  }

  let result;
  try {
    result = await uploadResult.json();
  } catch (err) {
    return {
      success: false,
      error: "Failed to parse response from Dropbox",
      details: err.message,
    };
  }

  return {
    success: true,
    id: result.id,
    participantNumber: 1, // Se debe calcular listando todos los archivos
  };
}

// Función para listar todas las sesiones de un experimento en Dropbox
export async function listSessionsDropbox(
  dropboxFolder,
  dropboxToken,
  experimentID
) {
  const listResult = await fetch(
    "https://api.dropboxapi.com/2/files/list_folder",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: dropboxFolder,
        recursive: false,
      }),
    }
  );

  if (listResult.status !== 200) {
    let errorText = listResult.statusText;
    try {
      const result = await listResult.json();
      errorText = result.error_summary || listResult.statusText;
    } catch (err) {
      // Si no se puede parsear el JSON, usar el statusText
    }
    return {
      success: false,
      errorCode: listResult.status,
      errorText: errorText,
      sessions: [],
    };
  }

  let result;
  try {
    result = await listResult.json();
  } catch (err) {
    return {
      success: false,
      error: "Failed to parse response from Dropbox",
      details: err.message,
      sessions: [],
    };
  }

  // Filtrar archivos que correspondan al experimentID
  const sessions = result.entries
    .filter(
      (entry) =>
        entry[".tag"] === "file" &&
        entry.name.startsWith(`${experimentID}_`) &&
        entry.name.endsWith(".json")
    )
    .map((entry) => {
      const sessionId = entry.name
        .replace(`${experimentID}_`, "")
        .replace(".json", "");
      return {
        sessionId,
        experimentID,
        createdAt: entry.server_modified,
        name: entry.name,
        path: entry.path_display,
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    success: true,
    sessions,
  };
}

// Función para descargar los datos de una sesión como CSV
export async function downloadSessionDropbox(
  dropboxFolder,
  dropboxToken,
  experimentID,
  sessionId
) {
  const filePath = `${dropboxFolder}/${experimentID}_${sessionId}.json`;

  // Descargar el archivo
  const downloadResult = await fetch(
    "https://content.dropboxapi.com/2/files/download",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxToken}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: filePath,
        }),
      },
    }
  );

  if (downloadResult.status !== 200) {
    return {
      success: false,
      error: "Session not found",
    };
  }

  const fileContent = await downloadResult.text();
  let sessionData;

  try {
    sessionData = JSON.parse(fileContent);
  } catch (err) {
    return {
      success: false,
      error: "Invalid JSON in session file",
    };
  }

  const filteredData = sessionData.data;

  if (!filteredData.length) {
    return {
      success: false,
      error: "No valid data to export",
    };
  }

  // Extraer todos los campos únicos
  const allFields = Array.from(
    new Set(filteredData.flatMap((row) => Object.keys(row)))
  );

  // Convertir a CSV manualmente
  const csvRows = [];
  csvRows.push(allFields.join(","));

  filteredData.forEach((row) => {
    const values = allFields.map((field) => {
      const value = row[field];
      if (value === null || value === undefined) return "";
      const stringValue = String(value);
      // Escapar comillas y envolver en comillas si contiene coma, comilla o salto de línea
      if (
        stringValue.includes(",") ||
        stringValue.includes('"') ||
        stringValue.includes("\n")
      ) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    });
    csvRows.push(values.join(","));
  });

  const csv = csvRows.join("\n");

  return {
    success: true,
    csv,
    filename: `session_${sessionId}.csv`,
  };
}

// Función para eliminar una sesión en Dropbox
export async function deleteSessionDropbox(
  dropboxFolder,
  dropboxToken,
  experimentID,
  sessionId
) {
  const filePath = `${dropboxFolder}/${experimentID}_${sessionId}.json`;

  const deleteResult = await fetch(
    "https://api.dropboxapi.com/2/files/delete_v2",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: filePath,
      }),
    }
  );

  if (deleteResult.status !== 200) {
    let errorText = deleteResult.statusText;
    try {
      const result = await deleteResult.json();
      errorText = result.error_summary || deleteResult.statusText;
    } catch (err) {
      // Si no se puede parsear el JSON, usar el statusText
    }
    return {
      success: false,
      errorCode: deleteResult.status,
      errorText: errorText,
    };
  }

  return {
    success: true,
  };
}

// Función original mantenida para compatibilidad
export default async function postFileDropbox(
  dropboxFolder, // ruta de la carpeta en dropbox
  dropboxToken, // token de acceso de dropbox
  filedata, // data generada por trial
  filename // nombre del archivo
) {
  const filePath = `${dropboxFolder}/${filename}`;

  const dropboxResult = await fetch(
    "https://content.dropboxapi.com/2/files/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxToken}`,
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

  if (dropboxResult.status !== 200) {
    let errorText = dropboxResult.statusText;
    try {
      const result = await dropboxResult.json();
      errorText = result.error_summary || dropboxResult.statusText;
    } catch (err) {
      // Si no se puede parsear el JSON, usar el statusText
    }
    return {
      success: false,
      errorCode: dropboxResult.status,
      errorText: errorText,
    };
  }

  try {
    await dropboxResult.json();
  } catch (err) {
    // No necesitamos el resultado, solo verificar que sea válido
  }

  return { success: true, errorCode: null, errorText: null };
}

// Función para crear una carpeta en Dropbox
export async function createFolderDropbox(dropboxToken, folderPath) {
  try {
    const createFolderResult = await fetch(
      "https://api.dropboxapi.com/2/files/create_folder_v2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dropboxToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: folderPath,
          autorename: false,
        }),
      }
    );

    let result;
    try {
      result = await createFolderResult.json();
    } catch (err) {
      return {
        success: false,
        errorText: "Failed to parse response from Dropbox",
      };
    }

    // Si la carpeta ya existe (409), también es un éxito
    if (createFolderResult.status === 200) {
      return {
        success: true,
        metadata: result.metadata,
      };
    } else if (
      createFolderResult.status === 409 &&
      result.error &&
      result.error[".tag"] === "path" &&
      result.error.path &&
      result.error.path[".tag"] === "conflict"
    ) {
      return {
        success: true,
        alreadyExists: true,
      };
    } else {
      return {
        success: false,
        errorCode: createFolderResult.status,
        errorText: result.error_summary || createFolderResult.statusText,
      };
    }
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}

// Función para eliminar una carpeta en Dropbox (y todo su contenido)
export async function deleteFolderDropbox(dropboxToken, folderPath) {
  try {
    const deleteFolderResult = await fetch(
      "https://api.dropboxapi.com/2/files/delete_v2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dropboxToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: folderPath,
        }),
      }
    );

    let result;
    try {
      result = await deleteFolderResult.json();
    } catch (err) {
      return {
        success: false,
        errorText: "Failed to parse response from Dropbox",
      };
    }

    if (deleteFolderResult.status === 200) {
      return {
        success: true,
        metadata: result.metadata,
      };
    } else {
      return {
        success: false,
        errorCode: deleteFolderResult.status,
        errorText: result.error_summary || deleteFolderResult.statusText,
      };
    }
  } catch (error) {
    return {
      success: false,
      errorText: error.message,
    };
  }
}
