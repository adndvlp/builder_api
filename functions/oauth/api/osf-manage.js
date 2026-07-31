import { onRequest } from "firebase-functions/v2/https";
import { handleSaveToken } from "../providers/osf/manage/save-token.js";
import { handleValidateToken } from "../providers/osf/manage/validate-token.js";
import { handleDisconnect } from "../providers/osf/manage/disconnect.js";
import { handleCreateComponent } from "../providers/osf/manage/create-component.js";
import { handleUploadFile } from "../providers/osf/manage/upload-file.js";

/**
 * Función unificada para manejar todas las operaciones de OSF
 *
 * Acciones soportadas:
 * - saveToken: Guardar y validar token de OSF
 * - validateToken: Validar token existente
 * - disconnect: Desconectar OSF (eliminar token)
 * - createComponent: Crear componente de datos en proyecto OSF
 * - uploadFile: Subir archivo a componente OSF
 */
export const osfManage = onRequest({ cors: true }, async (req, res) => {
  // T-10: CORS headers handled by onRequest({cors:true}). Keep OPTIONS short-
  // circuit for environments that bypass the wrapper (unit tests).
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // T-2: all osfManage actions mutate user state — require Firebase Auth
  // and assert the uid in the body/query matches the authenticated user.
  const { requireAuth } = await import("../../utils/auth.js");
  const authedUid = await requireAuth(req, res);
  if (!authedUid) return;

  const action = req.body.action || req.query.action;

  try {
    switch (action) {
      case "saveToken":
        return await handleSaveToken(req, res);
      case "validateToken":
        return await handleValidateToken(req, res);
      case "disconnect":
        return await handleDisconnect(req, res);
      case "createComponent":
        return await handleCreateComponent(req, res);
      case "uploadFile":
        return await handleUploadFile(req, res);
      default:
        return res.status(400).json({
          success: false,
          message:
            "Invalid action. Supported: saveToken, validateToken, disconnect, createComponent, uploadFile",
        });
    }
  } catch (error) {
    // T-11: log internal error detail; respond generic.
    console.error("Error in osfManage:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});
