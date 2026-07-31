import fetch from "../../../../../utils/fetch-with-timeout.js";
import { mimeFromFilename } from "../../helpers.js";

export async function postFile(token, folderIdentifier, filedata, filename) {
  const mime = mimeFromFilename(filename);
  const metadata = {
    name: filename,
    mimeType: mime,
    parents: [folderIdentifier],
  };

  const boundary = "-------314159265358979323846";
  const open_delim = "--" + boundary + "\r\n";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const multipartRequestBody =
    open_delim +
    "Content-Type: application/json\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mime}\r\n\r\n` +
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
}
