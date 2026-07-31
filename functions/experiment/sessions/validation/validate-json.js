/**
 * Validates a JSON payload carries every required field.
 *
 * Misc-3: returns a result envelope `{valid, reason?, missingFields?}` so
 * callers can surface a useful 4xx message. Misc-4 semantics preserved:
 * arrays require EVERY element to carry every required field.
 *
 * @returns {{valid: boolean, reason?: string, missingFields?: string[]}}
 */
export default function validateJSON(json, requiredFields) {
  let parsedJSON;
  try {
    parsedJSON = JSON.parse(json);
  } catch {
    return { valid: false, reason: "PARSE_ERROR" };
  }

  if (Array.isArray(parsedJSON)) {
    if (parsedJSON.length === 0) {
      if (requiredFields.length === 0) return { valid: true };
      return {
        valid: false,
        reason: "EMPTY_ARRAY",
        missingFields: requiredFields,
      };
    }
    for (const obj of parsedJSON) {
      if (obj == null || typeof obj !== "object") {
        return { valid: false, reason: "INVALID_ELEMENT" };
      }
      const missing = requiredFields.filter(
        (field) => !Object.prototype.hasOwnProperty.call(obj, field),
      );
      if (missing.length > 0) {
        return {
          valid: false,
          reason: "MISSING_FIELDS",
          missingFields: missing,
        };
      }
    }
    return { valid: true };
  }

  if (parsedJSON == null || typeof parsedJSON !== "object") {
    return { valid: false, reason: "NOT_OBJECT" };
  }
  const missing = requiredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(parsedJSON, field),
  );
  if (missing.length > 0) {
    return { valid: false, reason: "MISSING_FIELDS", missingFields: missing };
  }
  return { valid: true };
}
