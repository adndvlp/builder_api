import fetch from "../../../../utils/fetch-with-timeout.js";
import { db } from "../../../../app.js";
import { validateOSFToken } from "./validate-token.js";

/**
 * Guardar token de OSF
 */
export async function handleSaveToken(req, res) {
  // O-5: accept fields from either body or query.
  const uid = req.body?.uid ?? req.query?.uid;
  const token = req.body?.token ?? req.query?.token;
  const projectId = req.body?.projectId ?? req.query?.projectId;

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

  // Validar que el proyecto existe y el usuario tiene acceso de ESCRITURA
  // (O-3): un token con scope read-only pasaba este check, pero las uploads
  // fallaban más tarde. `current_user_permissions` debe incluir "write".
  try {
    const projectResponse = await fetch(
      `https://api.osf.io/v2/nodes/${projectId}/`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!projectResponse.ok) {
      return res.status(400).json({
        success: false,
        message: "Invalid OSF Project ID or no access to project",
      });
    }

    const projectData = await projectResponse.json();
    const perms =
      projectData?.data?.attributes?.current_user_permissions || [];
    if (!perms.includes("write") && !perms.includes("admin")) {
      return res.status(400).json({
        success: false,
        message:
          "OSF token does not have write access to this project. Generate a token with write scope.",
      });
    }
  } catch (error) {
    console.error("Failed to validate OSF Project ID:", error);
    return res.status(400).json({
      success: false,
      message: "Failed to validate OSF Project ID",
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
    { merge: true },
  );

  console.log("OSF token and project ID saved successfully for user:", uid);

  return res.status(200).json({
    success: true,
    message: "OSF token saved successfully",
    userId: validation.userId,
    userName: validation.fullName,
  });
}
