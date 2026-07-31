import { getSessionStorageProvider } from "./provider-registry.js";
import { rejectUnsafeIds } from "./helpers.js";

export {
  escapeDriveQueryValue,
  mimeFromFilename,
  searchDriveFileByName,
  isSafeStorageId,
} from "./helpers.js";

/**
 * Crea una nueva sesión (archivo CSV)
 * @param {string} provider - Proveedor ('dropbox', 'googledrive', o 'osf')
 * @param {string} token - Token de acceso
 * @param {string} folderIdentifier - Ruta de carpeta (dropbox), ID (googledrive), o uploadLink (osf)
 * @param {string} experimentID - ID del experimento
 * @param {string} sessionId - ID de la sesión
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function createSession(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const idError = rejectUnsafeIds(experimentID, sessionId);
  if (idError) return idError;
  const impl = getSessionStorageProvider(provider);
  if (!impl) return { success: false, errorText: "Unknown provider" };
  return impl.createSession(token, folderIdentifier, experimentID, sessionId);
}

/**
 * Agrega/actualiza datos en una sesión existente
 */
export async function appendResult(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
  csvContent,
) {
  const idError = rejectUnsafeIds(experimentID, sessionId);
  if (idError) return idError;
  const impl = getSessionStorageProvider(provider);
  if (!impl) return { success: false, errorText: "Unknown provider" };
  return impl.appendResult(
    token,
    folderIdentifier,
    experimentID,
    sessionId,
    csvContent,
  );
}

/**
 * Lista todas las sesiones de un experimento
 */
export async function listSessions(
  provider,
  token,
  folderIdentifier,
  experimentID,
) {
  const idError = rejectUnsafeIds(experimentID);
  if (idError) return { ...idError, sessions: [] };
  const impl = getSessionStorageProvider(provider);
  if (!impl)
    return { success: false, errorText: "Unknown provider", sessions: [] };
  return impl.listSessions(token, folderIdentifier, experimentID);
}

/**
 * Descarga los datos de una sesión
 */
export async function downloadSession(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const idError = rejectUnsafeIds(experimentID, sessionId);
  if (idError) return idError;
  const impl = getSessionStorageProvider(provider);
  if (!impl) return { success: false, errorText: "Unknown provider" };
  return impl.downloadSession(token, folderIdentifier, experimentID, sessionId);
}

/**
 * Elimina una sesión
 */
export async function deleteSession(
  provider,
  token,
  folderIdentifier,
  experimentID,
  sessionId,
) {
  const idError = rejectUnsafeIds(experimentID, sessionId);
  if (idError) return idError;
  const impl = getSessionStorageProvider(provider);
  if (!impl) return { success: false, errorText: "Unknown provider" };
  return impl.deleteSession(token, folderIdentifier, experimentID, sessionId);
}

/**
 * Guarda un archivo completo en el proveedor (función legacy)
 */
export async function postFile(
  provider,
  token,
  folderIdentifier,
  filedata,
  filename,
) {
  // S-7: caller-supplied filename — reject path separators and traversal.
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename.length > 200 ||
    /[\\/]|^\.|\.\./.test(filename)
  ) {
    return {
      success: false,
      errorCode: 400,
      errorText: "Invalid filename",
    };
  }
  const impl = getSessionStorageProvider(provider);
  if (!impl) return { success: false, errorText: "Unknown provider" };
  return impl.postFile(token, folderIdentifier, filedata, filename);
}
