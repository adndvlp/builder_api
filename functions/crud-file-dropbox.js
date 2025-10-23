import fetch from "node-fetch";

// Función para crear una nueva sesión en Dropbox (ahora como CSV)
export async function createSessionDropbox(
  dropboxFolder,
  dropboxToken,
  experimentID,
  sessionId
) {
  const filePath = `${dropboxFolder}/${experimentID}_${sessionId}.csv`;

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

  // Crear archivo CSV vacío (sin encabezados porque aún no sabemos las columnas)
  const initialCSV = "";

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
      body: initialCSV,
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

// Función para agregar una fila CSV a una sesión existente en Dropbox
export async function appendResultDropbox(
  dropboxFolder,
  dropboxToken,
  experimentID,
  sessionId,
  csvRow
) {
  const filePath = `${dropboxFolder}/${experimentID}_${sessionId}.csv`;

  // Descargar el archivo CSV existente
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
      body: updatedCSV,
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
    participantNumber: 1,
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

  // Filtrar archivos que correspondan al experimentID (ahora busca .csv)
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
  const filePath = `${dropboxFolder}/${experimentID}_${sessionId}.csv`;

  // Descargar el archivo CSV directamente
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

  const csv = await downloadResult.text();

  return {
    success: true,
    csv,
    filename: `${experimentID}_${sessionId}.csv`,
  };
}

// Función para eliminar una sesión en Dropbox
export async function deleteSessionDropbox(
  dropboxFolder,
  dropboxToken,
  experimentID,
  sessionId
) {
  const filePath = `${dropboxFolder}/${experimentID}_${sessionId}.csv`;

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
