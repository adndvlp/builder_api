import fetch from "../../../../utils/fetch-with-timeout.js";
import { db } from "../../../../app.js";

/**
 * Crear componente de datos en OSF
 */
export async function handleCreateComponent(req, res) {
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
    projectId,
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

  // Primero, verificar si ya existe un componente con este nombre
  console.log(
    `OSF: Checking for existing component with name "${componentName}"`,
  );

  const listResponse = await fetch(
    `https://api.osf.io/v2/nodes/${projectId}/children/`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (listResponse.ok) {
    const listData = await listResponse.json();
    const existingComponent = listData.data.find(
      (node) => node.attributes.title === componentName,
    );

    if (existingComponent) {
      console.log(
        `OSF: Found existing component with id ${existingComponent.id}`,
      );

      // Obtener el enlace de subida de archivos del componente existente
      const filesLink =
        existingComponent.relationships.files.links.related.href;
      const filesResponse = await fetch(filesLink, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!filesResponse.ok) {
        const errorText = await filesResponse.text();
        return res.status(filesResponse.status).json({
          success: false,
          message: "Error fetching files endpoint for existing OSF component",
          error: errorText,
          componentId: existingComponent.id,
        });
      }

      const filesData = await filesResponse.json();
      const uploadLink = filesData.data?.[0]?.links?.upload;
      if (!uploadLink) {
        return res.status(502).json({
          success: false,
          message:
            "OSF files endpoint returned unexpected shape for existing component (no upload link)",
          componentId: existingComponent.id,
        });
      }

      return res.status(200).json({
        success: true,
        message: "OSF data component already exists, reusing it",
        componentId: existingComponent.id,
        uploadLink: uploadLink,
        componentUrl: `https://osf.io/${existingComponent.id}`,
        alreadyExists: true,
      });
    }
  }

  // No existe, crear el componente de datos en OSF
  console.log(`OSF: Creating new component with name "${componentName}"`);

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
    },
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

  if (!filesResponse.ok) {
    const errorText = await filesResponse.text();
    return res.status(filesResponse.status).json({
      success: false,
      message: "OSF data component was created but files endpoint failed",
      error: errorText,
      componentId,
    });
  }

  const filesData = await filesResponse.json();
  const uploadLink = filesData.data?.[0]?.links?.upload;
  if (!uploadLink) {
    return res.status(502).json({
      success: false,
      message:
        "OSF files endpoint returned unexpected shape after component creation (no upload link)",
      componentId,
    });
  }

  console.log("OSF data component created successfully:", componentId);

  return res.status(201).json({
    success: true,
    message: "OSF data component created successfully",
    componentId: componentId,
    uploadLink: uploadLink,
    componentUrl: `https://osf.io/${componentId}`,
  });
}
