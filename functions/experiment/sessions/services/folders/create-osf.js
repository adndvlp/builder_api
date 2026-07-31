import fetch from "../../../../utils/fetch-with-timeout.js";

async function getOsfUploadLink(token, filesLink) {
  const filesResponse = await fetch(filesLink, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const filesData = await filesResponse.json();
  return filesData.data[0].links.upload;
}

export async function createOsfFolder(token, projectId, componentName) {
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
      const filesLink =
        existingComponent.relationships.files.links.related.href;
      const uploadLink = await getOsfUploadLink(token, filesLink);

      return {
        success: true,
        componentId: existingComponent.id,
        uploadLink,
        alreadyExists: true,
        message: "OSF component already exists, reusing it",
      };
    }
  }

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
  const filesLink = nodeData.data.relationships.files.links.related.href;
  const uploadLink = await getOsfUploadLink(token, filesLink);

  return {
    success: true,
    componentId,
    uploadLink,
    message: "OSF component created successfully",
  };
}
