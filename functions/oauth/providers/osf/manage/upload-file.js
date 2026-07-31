import { db } from "../../../../app.js";
import fetch from "../../../../utils/fetch-with-timeout.js";

/**
 * Subir archivo a OSF
 */
export async function handleUploadFile(req, res) {
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

  // Construir la URL con el nombre del archivo.
  // OSF uploadLinks pueden venir con query existente (ej. "?kind=file"), así
  // que se elige `&` en ese caso para no producir un `?` duplicado.
  const queryParams = new URLSearchParams({
    type: "files",
    name: filename,
  });
  const separator = uploadLink.includes("?") ? "&" : "?";
  const uploadUrl = `${uploadLink}${separator}${queryParams.toString()}`;

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
