import fetch from "node-fetch";

/**
 * Crea una carpeta en el proveedor de almacenamiento
 * @param {string} provider - Proveedor ('dropbox', 'googledrive', o 'osf')
 * @param {string} token - Token de acceso
 * @param {string} folderPath - Ruta de la carpeta o project ID para OSF
 * @param {string} componentName - Nombre del componente (solo para OSF)
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function createFolder(
  provider,
  token,
  folderPath,
  componentName = "Data",
) {
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
        },
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
            searchQuery,
          )}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          },
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
            },
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
    } else if (provider === "osf") {
      // Para OSF, folderPath es el projectId y creamos un componente de datos
      const projectId = folderPath;

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

          const filesData = await filesResponse.json();
          const uploadLink = filesData.data[0].links.upload;

          return {
            success: true,
            componentId: existingComponent.id,
            uploadLink: uploadLink,
            alreadyExists: true,
            message: "OSF component already exists, reusing it",
          };
        }
      }

      // No existe, crear componente nuevo
      console.log(`OSF: Creating new component with name "${componentName}"`);

      const createResponse = await fetch(
        `https://api.osf.io/v2/nodes/${projectId}/children/?region=us`,
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
                description: "Data component for experiment results",
              },
            },
          }),
        },
      );

      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        return {
          success: false,
          errorText:
            errorData.errors?.[0]?.detail || "Error creating OSF component",
          errorCode: createResponse.status,
        };
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

      return {
        success: true,
        componentId: componentId,
        uploadLink: uploadLink,
        message: "OSF component created successfully",
      };
    }

    return { success: false, errorText: "Unknown provider" };
  } catch (error) {
    return { success: false, errorText: error.message };
  }
}

/**
 * Elimina una carpeta en el proveedor de almacenamiento
 * @param {string} provider - Proveedor ('dropbox', 'googledrive', o 'osf')
 * @param {string} token - Token de acceso
 * @param {string} folderPath - Ruta de la carpeta o component ID para OSF
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
        },
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
            searchQuery,
          )}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          },
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
          },
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
    } else if (provider === "osf") {
      // Para OSF, eliminamos el componente
      const componentId = folderPath;

      const deleteResponse = await fetch(
        `https://api.osf.io/v2/nodes/${componentId}/`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!deleteResponse.ok) {
        return {
          success: false,
          errorText: "Error deleting OSF component",
          errorCode: deleteResponse.status,
        };
      }

      return { success: true, message: "OSF component deleted successfully" };
    }

    return { success: false, errorText: "Unknown provider" };
  } catch (error) {
    return { success: false, errorText: error.message };
  }
}
