import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import fetch from "node-fetch";

// Inicializar Firebase Admin si no está inicializado
if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

/**
 * Valida un token de OSF
 * @param {string} token - Token personal de OSF
 * @returns {Promise<Object>} - Objeto con validez del token y datos del usuario
 */
async function validateOSFToken(token) {
  try {
    const response = await fetch("https://api.osf.io/v2/users/me/", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const userData = await response.json();
      return {
        valid: true,
        userId: userData.data.id,
        fullName: userData.data.attributes.full_name,
      };
    }

    return { valid: false };
  } catch (error) {
    console.error("Error validating OSF token:", error);
    return { valid: false, error: error.message };
  }
}

/**
 * Función unificada para manejar todas las operaciones de OSF
 *
 * Acciones soportadas:
 * - saveToken: Guardar y validar token de OSF
 * - validateToken: Validar token existente
 * - disconnect: Desconectar OSF (eliminar token)
 * - createComponent: Crear componente de datos en proyecto OSF
 * - uploadFile: Subir archivo a componente OSF
 */
export const osfManage = onRequest({ cors: true }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const action = req.body.action || req.query.action;

  try {
    switch (action) {
      case "saveToken":
        return await handleSaveToken(req, res);
      case "validateToken":
        return await handleValidateToken(req, res);
      case "disconnect":
        return await handleDisconnect(req, res);
      case "createComponent":
        return await handleCreateComponent(req, res);
      case "uploadFile":
        return await handleUploadFile(req, res);
      default:
        return res.status(400).json({
          success: false,
          message:
            "Invalid action. Supported: saveToken, validateToken, disconnect, createComponent, uploadFile",
        });
    }
  } catch (error) {
    console.error("Error in osfManage:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

/**
 * Guardar token de OSF
 */
async function handleSaveToken(req, res) {
  const { uid, token, projectId } = req.body;

  if (!uid || !token) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters: uid or token",
    });
  }

  if (!projectId) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameter: projectId",
    });
  }

  console.log("Validating OSF token for user:", uid);

  // Validar el token con OSF
  const validation = await validateOSFToken(token);

  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: "Invalid OSF token",
      error: validation.error,
    });
  }

  // Validar que el proyecto existe y el usuario tiene acceso
  try {
    const projectResponse = await fetch(
      `https://api.osf.io/v2/nodes/${projectId}/`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!projectResponse.ok) {
      return res.status(400).json({
        success: false,
        message: "Invalid OSF Project ID or no access to project",
      });
    }
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Failed to validate OSF Project ID",
      error: error.message,
    });
  }

  // Guardar el token y projectId en Firestore
  await db.collection("users").doc(uid).set(
    {
      osfToken: token,
      osfTokenValid: true,
      osfUserId: validation.userId,
      osfUserName: validation.fullName,
      osfProjectId: projectId,
    },
    { merge: true }
  );

  console.log("OSF token and project ID saved successfully for user:", uid);

  return res.status(200).json({
    success: true,
    message: "OSF token saved successfully",
    userId: validation.userId,
    userName: validation.fullName,
  });
}

/**
 * Validar token de OSF
 */
async function handleValidateToken(req, res) {
  const { uid } = req.query;

  if (!uid) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameter: uid",
    });
  }

  const userDoc = await db.collection("users").doc(uid).get();

  if (!userDoc.exists) {
    return res.status(400).json({
      success: false,
      message: "User not found",
    });
  }

  const userData = userDoc.data();
  const token = userData.osfToken;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: "OSF token not found",
    });
  }

  const validation = await validateOSFToken(token);

  // Actualizar el estado de validación en Firestore
  await db.collection("users").doc(uid).set(
    {
      osfTokenValid: validation.valid,
    },
    { merge: true }
  );

  return res.status(200).json({
    success: true,
    valid: validation.valid,
    userId: validation.userId,
    userName: validation.fullName,
  });
}

/**
 * Desconectar OSF
 */
async function handleDisconnect(req, res) {
  const { uid } = req.body;

  if (!uid) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameter: uid",
    });
  }

  // Eliminar el token de Firestore
  await db.collection("users").doc(uid).set(
    {
      osfToken: null,
      osfTokenValid: false,
      osfUserId: null,
      osfUserName: null,
      osfProjectId: null,
    },
    { merge: true }
  );

  console.log("OSF token disconnected for user:", uid);

  return res.status(200).json({
    success: true,
    message: "OSF disconnected successfully",
  });
}

/**
 * Crear componente de datos en OSF
 */
async function handleCreateComponent(req, res) {
  const { uid, projectId, componentName = "Data", region = "us" } = req.body;

  if (!uid || !projectId) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters: uid or projectId",
    });
  }

  console.log(
    "Creating OSF data component for user:",
    uid,
    "project:",
    projectId
  );

  // Obtener el token de OSF
  const userDoc = await db.collection("users").doc(uid).get();

  if (!userDoc.exists) {
    return res.status(400).json({
      success: false,
      message: "User not found",
    });
  }

  const userData = userDoc.data();
  const token = userData.osfToken;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: "OSF token not found or invalid",
    });
  }

  // Crear el componente de datos en OSF
  const createResponse = await fetch(
    `https://api.osf.io/v2/nodes/${projectId}/children/?region=${region}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        data: {
          type: "nodes",
          attributes: {
            title: componentName,
            category: "data",
            description: "Data component created for experiment results",
          },
        },
      }),
    }
  );

  if (!createResponse.ok) {
    const errorData = await createResponse.json();
    return res.status(createResponse.status).json({
      success: false,
      message: "Error creating OSF data component",
      error: errorData.errors || errorData,
    });
  }

  const nodeData = await createResponse.json();
  const componentId = nodeData.data.id;

  // Obtener el enlace de subida de archivos
  const filesLink = nodeData.data.relationships.files.links.related.href;

  const filesResponse = await fetch(filesLink, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const filesData = await filesResponse.json();
  const uploadLink = filesData.data[0].links.upload;

  console.log("OSF data component created successfully:", componentId);

  return res.status(201).json({
    success: true,
    message: "OSF data component created successfully",
    componentId: componentId,
    uploadLink: uploadLink,
    componentUrl: `https://osf.io/${componentId}`,
  });
}

/**
 * Subir archivo a OSF
 */
async function handleUploadFile(req, res) {
  const { uid, uploadLink, filename, fileContent } = req.body;

  if (!uid || !uploadLink || !filename || !fileContent) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required parameters: uid, uploadLink, filename, or fileContent",
    });
  }

  console.log("Uploading file to OSF:", filename);

  // Obtener el token de OSF
  const userDoc = await db.collection("users").doc(uid).get();

  if (!userDoc.exists) {
    return res.status(400).json({
      success: false,
      message: "User not found",
    });
  }

  const userData = userDoc.data();
  const token = userData.osfToken;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: "OSF token not found or invalid",
    });
  }

  // Construir la URL con el nombre del archivo
  const queryParams = new URLSearchParams({
    type: "files",
    name: filename,
  });

  const uploadUrl = `${uploadLink}?${queryParams.toString()}`;

  // Subir el archivo a OSF
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: fileContent,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    return res.status(uploadResponse.status).json({
      success: false,
      message: "Error uploading file to OSF",
      error: errorText,
      statusCode: uploadResponse.status,
    });
  }

  const uploadData = await uploadResponse.json();

  console.log("File uploaded successfully to OSF:", filename);

  return res.status(201).json({
    success: true,
    message: "File uploaded successfully to OSF",
    fileId: uploadData.data?.id,
    fileUrl: uploadData.data?.links?.download,
  });
}
