import { onRequest } from "firebase-functions/v2/https";
import { apiData as apiDataDrive } from "./api-data-drive.js";
import { apiData as apiDataDropbox } from "./api-data-dropbox.js";
import { apiCreateExperiment as apiCreateExperimentDrive } from "./api-create-experiment-drive.js";
import { apiCreateExperiment as apiCreateExperimentDropbox } from "./api-create-experiment-dropbox.js";
import { apiDeleteExperiment as apiDeleteExperimentDrive } from "./api-delete-experiment-drive.js";
import { apiDeleteExperiment as apiDeleteExperimentDropbox } from "./api-delete-experiment-dropbox.js";

// Handler central para distribuir peticiones según el proveedor de almacenamiento y acción
export const apiDataHandler = onRequest({ cors: true }, async (req, res) => {
  const { storage, action } = req.body;

  if (!storage || (storage !== "drive" && storage !== "dropbox")) {
    res.status(400).json({
      success: false,
      message:
        "Missing or invalid 'storage' parameter. Use 'drive' or 'dropbox'.",
    });
    return;
  }

  // Distribuir según acción
  if (action === "createExperiment") {
    if (storage === "drive") {
      return await apiCreateExperimentDrive.run(req, res);
    } else {
      return await apiCreateExperimentDropbox.run(req, res);
    }
  }

  if (action === "deleteExperiment") {
    if (storage === "drive") {
      return await apiDeleteExperimentDrive.run(req, res);
    } else {
      return await apiDeleteExperimentDropbox.run(req, res);
    }
  }

  // Finalizar sesión (action: "finish")
  if (action === "finish") {
    if (storage === "drive") {
      return await apiDataDrive.run(req, res);
    } else {
      return await apiDataDropbox.run(req, res);
    }
  }

  // Acciones estándar de datos (list, download, delete, createSession, appendResult, etc.)
  if (storage === "drive") {
    return await apiDataDrive.run(req, res);
  } else {
    return await apiDataDropbox.run(req, res);
  }
});
