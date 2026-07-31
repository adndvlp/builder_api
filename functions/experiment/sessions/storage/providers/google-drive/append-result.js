import fetch from "../../../../../utils/fetch-with-timeout.js";
import { searchDriveFileByName } from "../../helpers.js";

export async function appendResult(
  token,
  folderIdentifier,
  experimentID,
  sessionId,
  csvContent,
) {
  const fileName = `${experimentID}_${sessionId}.csv`;

  const searchResult = await searchDriveFileByName(
    token,
    folderIdentifier,
    fileName,
  );
  const searchData = await searchResult.json();

  if (!searchData.files || searchData.files.length === 0) {
    console.log(`Drive: Creating new file ${fileName} (batch=0 mode)`);

    const metadata = {
      name: fileName,
      mimeType: "text/csv",
      parents: [folderIdentifier],
    };

    const createResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/related; boundary=foo_bar_baz",
        },
        body:
          "--foo_bar_baz\r\n" +
          "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
          JSON.stringify(metadata) +
          "\r\n--foo_bar_baz\r\n" +
          "Content-Type: text/csv\r\n\r\n" +
          csvContent +
          "\r\n--foo_bar_baz--",
      },
    );

    if (!createResponse.ok) {
      const result = await createResponse.json();
      return {
        success: false,
        errorText: result.error?.message || "Error creating file",
        errorCode: createResponse.status,
      };
    }

    const createResult = await createResponse.json();
    return { success: true, id: createResult.id };
  }

  const fileId = searchData.files[0].id;
  const uploadResult = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/csv",
      },
      body: csvContent,
    },
  );

  if (!uploadResult.ok) {
    const result = await uploadResult.json();
    return {
      success: false,
      errorText: result.error?.message || "Error updating file",
      errorCode: uploadResult.status,
    };
  }

  return { success: true, id: fileId };
}
