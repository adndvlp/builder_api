import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../../app.js";
import writeLog from "../logging/write-log.js";
import MESSAGES from "../../api/messages.js";
import validateJSON from "../validation/validate-json.js";

/**
 * Sanitiza datos para Firestore, convirtiendo arrays/objetos anidados problemáticos.
 * Firestore no permite arrays anidados — los envolvemos en un sentinel
 * `{ __json: "..." }` para que deserializeFromFirestore pueda revertirlo
 * sin confundirlos con strings legítimos que casualmente empiecen con `[`/`{`.
 */
function sanitizeForFirestore(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Si es un array
  if (Array.isArray(obj)) {
    const hasNestedStructures = obj.some(
      (item) =>
        Array.isArray(item) || (typeof item === "object" && item !== null),
    );

    if (hasNestedStructures) {
      // Sentinel explícito — solo este shape será deserializado en lectura
      return { __json: JSON.stringify(obj) };
    }

    return obj;
  }

  if (typeof obj === "object") {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeForFirestore(value);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Función auxiliar para agregar resultado (guarda en Firestore temporalmente)
 */
export async function handleAppendResult(req, res, experimentID, sessionId, data) {
  try {
    await writeLog(experimentID, "appendResult");

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();

    if (!exp_doc.exists) {
      res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
      return;
    }

    const exp_data = exp_doc.data();
    if (!exp_data.active) {
      res.status(400).json(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
      return;
    }

    // Siempre guardar como JSON
    let parsedData = data;
    if (typeof data === "string") {
      try {
        parsedData = JSON.parse(data);
      } catch (err) {
        res.status(400).json({
          success: false,
          message: "Invalid JSON in data parameter",
        });
        return;
      }
    }

    // Detectar si es un batch concatenado (tiene trialsData como string JSON).
    // H-10: presence-based check (typeof, not truthiness) so trialsData=""
    // is recognized as a malformed batch attempt instead of silently
    // routing to the single-trial path with garbage state.
    const isBatchConcatenated = typeof parsedData.trialsData === "string";
    if (isBatchConcatenated && parsedData.trialsData.length === 0) {
      res.status(400).json({
        success: false,
        message: "Empty trialsData in batch payload",
      });
      return;
    }

    // Validar los datos si está configurado (SALTAR validación para batches concatenados)
    if (exp_data.useValidation && !isBatchConcatenated) {
      let validationResult = { valid: false, reason: "NO_VALIDATOR" };
      if (exp_data.allowJSON) {
        validationResult = validateJSON(
          JSON.stringify([parsedData]),
          exp_data.requiredFields,
        );
      }
      // H-9: if allowJSON is off but the experiment accepts CSV, require that
      // the trial object at minimum carries the configured requiredFields as
      // keys. Without this branch the validation always fails the request.
      if (!validationResult.valid && exp_data.allowCSV) {
        const requiredFields = exp_data.requiredFields || [];
        const missing =
          parsedData != null && typeof parsedData === "object"
            ? requiredFields.filter(
                (f) => !Object.prototype.hasOwnProperty.call(parsedData, f),
              )
            : requiredFields;
        validationResult =
          missing.length === 0
            ? { valid: true }
            : { valid: false, reason: "MISSING_FIELDS", missingFields: missing };
      }
      if (!validationResult.valid) {
        // Misc-3: surface validator reason + missing fields in the 400 body.
        res.status(400).json({
          ...MESSAGES.INVALID_DATA,
          reason: validationResult.reason,
          ...(validationResult.missingFields && {
            missingFields: validationResult.missingFields,
          }),
        });
        return;
      }
    }

    if (isBatchConcatenated) {
      console.log("Appending BATCH to Firestore temporarily:", {
        experimentID,
        sessionId,
        batchNumber: parsedData.batchNumber,
        trialsCount: parsedData.trialsCount,
      });
    } else {
      console.log("Appending JSON result to Firestore temporarily:", {
        experimentID,
        sessionId,
      });
    }

    // Validar que tenga clientTimestamp (solo para trials individuales)
    if (!isBatchConcatenated && !parsedData.clientTimestamp) {
      console.warn(
        "Trial data missing clientTimestamp, adding server timestamp",
      );
      parsedData.clientTimestamp = Date.now();
    }

    // H-6/H-7: trial document ID must be unique. Previously `${ts}_${idx}`
    // collided whenever two trials arrived with the same clientTimestamp+
    // trial_index (race or buggy client), and `batch_undefined_0` collided
    // for clients that omitted batchNumber. Always append a Firestore-
    // generated suffix so concurrent writes cannot overwrite each other.
    const trials_col = db
      .collection("experiments")
      .doc(experimentID)
      .collection("sessions")
      .doc(sessionId)
      .collection("trials");
    const uniqueSuffix = trials_col.doc().id;

    let trialId;
    if (isBatchConcatenated) {
      const batchNumber = parsedData.batchNumber ?? "x";
      trialId = `batch_${batchNumber}_${parsedData.firstTrialIndex || 0}_${uniqueSuffix}`;
    } else {
      const trialIndex = parsedData.trial_index ?? "x";
      const clientTimestamp = parsedData.clientTimestamp;
      trialId = `${clientTimestamp}_${trialIndex}_${uniqueSuffix}`;
    }

    // Serializar datos para Firestore (convierte arrays/objetos anidados problemáticos)
    const sanitizedData = sanitizeForFirestore(parsedData);

    // Guardar cada trial como documento separado en subcolección
    const trial_ref = trials_col.doc(trialId);

    await trial_ref.set(sanitizedData);

    // Crear/actualizar documento de sesión con metadata
    const session_ref = db
      .collection("experiments")
      .doc(experimentID)
      .collection("sessions")
      .doc(sessionId);

    const session_doc = await session_ref.get();
    if (!session_doc.exists) {
      // H-3 fix: usar ISO string igual que handleCreateSession para que
      // finalizeSession (que lee createdAt como string) no genere "Invalid Date".
      await session_ref.set({
        createdAt: new Date().toISOString(),
        trialCount: 1,
      });
    } else {
      await session_ref.update({
        trialCount: FieldValue.increment(1),
      });
    }

    console.log(
      isBatchConcatenated
        ? `Batch ${parsedData.batchNumber} saved to Firestore successfully`
        : `Trial ${trialId} saved to Firestore successfully`,
    );

    res.status(201).json({
      success: true,
      message: isBatchConcatenated
        ? "Batch appended successfully to temporary storage"
        : "JSON result appended successfully to temporary storage",
    });
  } catch (error) {
    console.error("Error in handleAppendResult:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}
