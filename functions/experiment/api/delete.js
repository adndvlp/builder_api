import { onRequest } from "firebase-functions/v2/https";
import { requireAuth } from "../../utils/auth.js";
import { deleteExperiment } from "../delete.js";

/**
 * Endpoint HTTP para eliminar un experimento
 */
export const apiDeleteExperiment = onRequest(
  { cors: true },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    // T-2: admin endpoint — Firebase Auth required; the authenticated uid
    // must match `req.body.uid` (if supplied) and is then used for OAuth
    // token lookup in deleteExperiment.
    const authedUid = await requireAuth(req, res);
    if (!authedUid) return;

    const { experimentID, repoName } = req.body;

    if (!experimentID) {
      res.status(400).json({
        success: false,
        message: "Missing required parameter: experimentID",
      });
      return;
    }

    try {
      const result = await deleteExperiment(experimentID, authedUid, repoName);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === "EXPERIMENT_NOT_FOUND") {
        res.status(404).json({
          success: false,
          message: "Experiment not found",
        });
      } else {
        // T-11: log internal detail; respond generic.
        console.error("Error deleting experiment:", error);
        res.status(500).json({
          success: false,
          message: "Internal server error",
        });
      }
    }
  },
);
