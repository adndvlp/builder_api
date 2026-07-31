import fetch from "../../../../utils/fetch-with-timeout.js";
import { db } from "../../../../app.js";

/**
 * Valida un token de OSF
 * @param {string} token - Token personal de OSF
 * @returns {Promise<Object>} - Objeto con validez del token y datos del usuario
 */
export async function validateOSFToken(token) {
  try {
    const response = await fetch("https://api.osf.io/v2/users/me/", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const userData = await response.json();
      return {
        valid: true,
        userId: userData.data.id,
        fullName: userData.data.attributes.full_name,
      };
    }

    return { valid: false };
  } catch (error) {
    console.error("Error validating OSF token:", error);
    return { valid: false, error: error.message };
  }
}

/**
 * Validar token de OSF
 */
export async function handleValidateToken(req, res) {
  // O-5: accept uid from either query or body for consistency with saveToken
  // and disconnect handlers.
  const uid = req.body?.uid ?? req.query?.uid;

  if (!uid) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameter: uid",
    });
  }

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
      message: "OSF token not found",
    });
  }

  const validation = await validateOSFToken(token);

  // Actualizar el estado de validación en Firestore
  await db.collection("users").doc(uid).set(
    {
      osfTokenValid: validation.valid,
    },
    { merge: true },
  );

  return res.status(200).json({
    success: true,
    valid: validation.valid,
    userId: validation.userId,
    userName: validation.fullName,
  });
}
