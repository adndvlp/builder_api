import fetch from "../../../../../utils/fetch-with-timeout.js";
import { searchDriveFileByName } from "../../helpers.js";

export async function createSession(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;
  const initialCSV = "";

  const checkResult = await searchDriveFileByName(
    token,
    folderIdentifier,
    fileName,
  );

  const checkData = await checkResult.json();
  if (checkData.files && checkData.files.length > 0) {
    return {
      success: false,
      errorText: "Session already exists",
      errorCode: 409,
    };
  }

  const metadata = {
    name: fileName,
    mimeType: "text/csv",
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
    "Content-Type: text/csv\r\n\r\n" +
    initialCSV +
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
      errorText: result.error?.message || "Error creating session",
      errorCode: uploadResult.status,
    };
  }

  return { success: true, id: result.id };
}
