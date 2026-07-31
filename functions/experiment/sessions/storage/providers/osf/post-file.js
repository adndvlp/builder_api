import fetch from "../../../../../utils/fetch-with-timeout.js";
import { mimeFromFilename } from "../../helpers.js";

export async function postFile(token, folderIdentifier, filedata, filename) {
  const uploadLink = folderIdentifier;
  const queryParams = new URLSearchParams({
    type: "files",
    name: filename,
  });

  const uploadUrl = `${uploadLink}?${queryParams.toString()}`;
  const uploadResult = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeFromFilename(filename),
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
