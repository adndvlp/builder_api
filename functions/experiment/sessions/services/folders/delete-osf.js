import fetch from "../../../../utils/fetch-with-timeout.js";

export async function deleteOsfFolder(token, componentId) {
  const filesResponse = await fetch(
    `https://api.osf.io/v2/nodes/${componentId}/files/osfstorage/`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!filesResponse.ok) {
    return {
      success: false,
      errorText: "Error listing OSF files for deletion",
      errorCode: filesResponse.status,
    };
  }

  const filesData = await filesResponse.json();
  const files = filesData.data || [];
  const failures = [];

  for (const file of files) {
    const deleteLink = file.links?.delete;
    if (!deleteLink) continue;
    const r = await fetch(deleteLink, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      failures.push(`${file.attributes?.name ?? file.id}: ${r.status}`);
    }
  }

  if (failures.length > 0) {
    return {
      success: false,
      errorText: `Failed to delete some OSF files: ${failures.join("; ")}`,
    };
  }

  return {
    success: true,
    deletedFiles: files.length,
    message: `Deleted ${files.length} files from OSF component (component kept)`,
  };
}
