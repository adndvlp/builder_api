import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../../app.js";
import writeLog from "../logging/write-log.js";
import MESSAGES from "../../api/messages.js";

/**
 * Función auxiliar para crear sesión
 * Obtiene el número de participante desde el contador de condiciones y lo retorna
 */
export async function handleCreateSession(req, res, experimentID, sessionId) {
  try {
    await writeLog(experimentID, "createSession");

    const { batchSize, sessionName } = req.body;
    console.log(
      `[CREATE SESSION] batchSize received: ${batchSize} (type: ${typeof batchSize})`,
    );

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    let exp_doc = await exp_doc_ref.get();

    // Si no existe el experimento, retornar error (ya no se crea automáticamente aquí)
    if (!exp_doc.exists) {
      res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
      return;
    }

    const exp_data = exp_doc.data();
    if (!exp_data.active) {
      res.status(400).json(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
      return;
    }

    if (exp_data.limitSessions) {
      if (exp_data.sessions >= exp_data.maxSessions) {
        res.status(400).json(MESSAGES.MAX_SESSIONS_REACHED);
        return;
      }
    }

    // Verificar si la sesión ya existe en Firestore (resume)
    const session_ref = db
      .collection("experiments")
      .doc(experimentID)
      .collection("sessions")
      .doc(sessionId);

    const existing_session = await session_ref.get();

    if (existing_session.exists) {
      // Sesión existente (resume) - devolver participantNumber guardado
      const session_data = existing_session.data();
      console.log("Session already exists (resume):", {
        experimentID,
        sessionId,
        participantNumber: session_data.participantNumber,
      });

      res.status(200).json({
        success: true,
        message: "Session resumed successfully",
        sessionId: sessionId,
        participantNumber: session_data.participantNumber,
      });
      return;
    }

    // Obtener número de participante desde el contador de condiciones.
    // H-11: when activeConditionAssignment is off, condition rotation isn't
    // needed but participantNumber still has to be assigned for the session
    // doc + storage filename. Increment the counter without modulo (effectively
    // treats nConditions as unbounded for numbering purposes) instead of
    // blocking session creation outright.
    let participantNumber;
    try {
      const conditionAssignmentActive =
        exp_data.activeConditionAssignment !== false;

      participantNumber = await db.runTransaction(async (t) => {
        const exp_doc = await t.get(exp_doc_ref);
        const exp_data_txn = exp_doc.data();
        const currentCondition = exp_data_txn.currentCondition || 0;

        let nextCondition;
        if (!conditionAssignmentActive) {
          // Monotonic counter for participantNumber, no rotation.
          nextCondition = currentCondition + 1;
        } else if (exp_data_txn.nConditions > 1) {
          nextCondition = (currentCondition + 1) % exp_data_txn.nConditions;
        } else {
          nextCondition = currentCondition + 1;
        }

        t.set(
          exp_doc_ref,
          { currentCondition: nextCondition },
          { merge: true },
        );
        return currentCondition;
      });
    } catch (error) {
      console.error("Error getting condition:", error);
      res.status(400).json(MESSAGES.UNKNOWN_ERROR_GETTING_CONDITION);
      return;
    }

    console.log("Session registered with participant number:", {
      experimentID,
      sessionId,
      participantNumber,
      batchSize,
    });

    // Si batchSize=0, NO crear documento de sesión (solo retornar participantNumber)
    // Los datos se enviarán directo al storage sin pasar por Firestore
    // Validar explícitamente que batchSize es 0 (no undefined, null, etc.)
    const shouldCreateSessionDoc =
      batchSize !== 0 && batchSize !== undefined && batchSize !== null;

    if (shouldCreateSessionDoc) {
      console.log(
        `[CREATE SESSION] Creating Firestore document (batchSize=${batchSize})`,
      );
      // Crear documento de sesión en Firestore (para batch>0 o sin IndexedDB)
      await session_ref.set({
        experimentID: experimentID,
        sessionId: sessionId,
        participantNumber: participantNumber,
        createdAt: new Date().toISOString(),
      });
    } else {
      console.log(
        `[CREATE SESSION] Skipping Firestore document creation (batchSize=${batchSize})`,
      );
    }

    // Incrementar contador de sesiones en Firestore
    await exp_doc_ref.set(
      { sessions: FieldValue.increment(1) },
      { merge: true },
    );

    // Write sessionName to session_metadata if provided
    if (sessionName) {
      try {
        await db
          .collection("experiments")
          .doc(experimentID)
          .collection("session_metadata")
          .doc(sessionId)
          .set(
            { sessionId, sessionName, createdAt: new Date().toISOString() },
            { merge: true },
          );
      } catch (metaErr) {
        console.error(
          "Error writing sessionName to session_metadata:",
          metaErr,
        );
      }
    }

    res.status(201).json({
      success: true,
      message: "Session registered successfully",
      sessionId: sessionId,
      participantNumber: participantNumber,
    });
  } catch (error) {
    console.error("Error in handleCreateSession:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}
