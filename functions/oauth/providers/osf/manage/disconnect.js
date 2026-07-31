import { db } from "../../../../app.js";

/**
 * Desconectar OSF
 */
export async function handleDisconnect(req, res) {
  const uid = req.body?.uid ?? req.query?.uid;

  if (!uid) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameter: uid",
    });
  }

  // Eliminar tokens de Firestore (osfTokens = OAuth, osfToken = manual)
  await db.collection("users").doc(uid).set(
    {
      osfTokens: null,
      osfToken: null,
      osfTokenValid: false,
      osfUserId: null,
      osfUserName: null,
      osfProjectId: null,
    },
    { merge: true },
  );

  console.log("OSF token disconnected for user:", uid);

  return res.status(200).json({
    success: true,
    message: "OSF disconnected successfully",
  });
}
