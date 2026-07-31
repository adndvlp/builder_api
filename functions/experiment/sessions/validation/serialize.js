import CSV from "csv-string";

/**
 * Deserializa datos desde Firestore. SOLO revierte valores envueltos en el
 * sentinel `{ __json: "..." }` puesto por sanitizeForFirestore. Strings
 * legítimos del cliente quedan intactos aunque empiecen con `[` o `{`.
 */
export function deserializeFromFirestore(obj) {
  if (obj === null || obj === undefined) return obj;

  // Detectar sentinel { __json: "..." } y deserializar
  if (
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    typeof obj.__json === "string" &&
    Object.keys(obj).length === 1
  ) {
    try {
      return JSON.parse(obj.__json);
    } catch {
      // Si el JSON está corrupto, devolver el string crudo (mejor que crash)
      return obj.__json;
    }
  }

  // Recursión por keys (NO toca strings — fix S-1)
  if (typeof obj === "object" && !Array.isArray(obj)) {
    const deserialized = {};
    for (const [key, value] of Object.entries(obj)) {
      deserialized[key] = deserializeFromFirestore(value);
    }
    return deserialized;
  }

  return obj;
}

/**
 * Merge two CSV strings by column union, preserving row order
 * (existing rows first, then new rows). Used by finalizeSession's PATCH
 * path on Drive/Dropbox to recover from schema changes between batches.
 *
 * @param {string} existingCsv CSV currently in remote storage. May be empty.
 * @param {string} newCsv      CSV produced by this finalization pass.
 * @returns {string} Unified CSV with union header.
 */
export function mergeCsvByColumns(existingCsv, newCsv) {
  const existingRows = existingCsv ? CSV.parse(existingCsv) : [];
  const newRows = newCsv ? CSV.parse(newCsv) : [];

  if (existingRows.length <= 1) {
    return newCsv;
  }
  if (newRows.length <= 1) {
    return existingCsv;
  }

  const existingHeader = existingRows[0];
  const newHeader = newRows[0];

  // Column union: preserve existing order, append new-only columns at the end.
  const unionHeader = [...existingHeader];
  for (const col of newHeader) {
    if (!unionHeader.includes(col)) unionHeader.push(col);
  }

  // Re-emit each row keyed by header.
  function rowsFromTable(table, header) {
    return table.slice(1).map((row) => {
      const obj = {};
      header.forEach((col, i) => {
        obj[col] = row[i] ?? "";
      });
      return obj;
    });
  }
  const allRows = [
    ...rowsFromTable(existingRows, existingHeader),
    ...rowsFromTable(newRows, newHeader),
  ];

  const output = [unionHeader, ...allRows.map((r) => unionHeader.map((c) => r[c] ?? ""))];
  return CSV.stringify(output);
}
