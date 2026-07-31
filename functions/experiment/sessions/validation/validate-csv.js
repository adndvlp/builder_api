import * as CSV from "csv-string";

/**
 * Validates a CSV string carries every required column header.
 *
 * Misc-3: exposes the *reason* a validation failed (parse error vs
 * missing-field) so the caller can return a useful 4xx message instead of
 * a generic "invalid data". Backward-compatible: the truthy/falsy contract
 * (`!result.valid` ⇒ failure) is unchanged for callers that ignore `.reason`.
 *
 * @returns {{valid: boolean, reason?: string, missingFields?: string[]}}
 */
export default function validateCSV(csv, requiredFields) {
  if (typeof csv !== "string" || csv.length === 0) {
    return { valid: false, reason: "EMPTY_CSV" };
  }
  let parsedCSV;
  try {
    parsedCSV = CSV.parse(csv);
  } catch {
    return { valid: false, reason: "PARSE_ERROR" };
  }
  if (!Array.isArray(parsedCSV) || parsedCSV.length === 0) {
    return { valid: false, reason: "PARSE_ERROR" };
  }
  const headers = parsedCSV[0];
  const missing = requiredFields.filter((field) => !headers.includes(field));
  if (missing.length > 0) {
    return { valid: false, reason: "MISSING_FIELDS", missingFields: missing };
  }
  return { valid: true };
}
