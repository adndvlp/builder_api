import { Parser } from "json2csv";
import { deserializeFromFirestore } from "../validation/serialize.js";

function expandTrialsSnapshot(trialsSnapshot) {
  let results = [];
  let __seq = 0;
  const parseFailures = [];

  trialsSnapshot.docs.forEach((doc) => {
    const data = doc.data();

    if (data.trialsData && typeof data.trialsData === "string") {
      try {
        const batchTrials = JSON.parse(data.trialsData);
        if (Array.isArray(batchTrials)) {
          const deserializedTrials = batchTrials.map((trial) => ({
            ...deserializeFromFirestore(trial),
            __seq: __seq++,
          }));
          results = results.concat(deserializedTrials);
          console.log(`Expanded batch with ${batchTrials.length} trials`);
        } else {
          parseFailures.push({
            trialDocId: doc.id,
            reason: "trialsData parsed but is not an array",
          });
        }
      } catch (err) {
        parseFailures.push({
          trialDocId: doc.id,
          reason: err.message,
        });
        console.error("Error parsing batch trialsData:", err);
      }
    } else {
      results.push({ ...deserializeFromFirestore(data), __seq: __seq++ });
    }
  });

  return { results, parseFailures };
}

function sortTrials(results) {
  results.sort((a, b) => {
    const tA = Number(a.clientTimestamp);
    const tB = Number(b.clientTimestamp);
    if (Number.isFinite(tA) && Number.isFinite(tB) && tA !== tB) {
      return tA - tB;
    }
    const iA = Number(a.trial_index);
    const iB = Number(b.trial_index);
    if (Number.isFinite(iA) && Number.isFinite(iB) && iA !== iB) {
      return iA - iB;
    }
    return (a.__seq ?? 0) - (b.__seq ?? 0);
  });
}

function addSessionMetadata(results, sessionData, sessionState, sessionId) {
  const metadata = sessionData.metadata || {};
  const createdAt = sessionData.createdAt || new Date().toISOString();

  return results.map((row) => {
    const { __seq: _drop, ...trial } = row;
    return {
      ...trial,
      session_browser: metadata.browser || "",
      session_browser_version: metadata.browserVersion || "",
      session_os: metadata.os || "",
      session_screen_resolution: metadata.screenResolution || "",
      session_language: metadata.language || "",
      session_started_at: metadata.startedAt || "",
      session_id: sessionId,
      session_created_at: createdAt,
      session_state: sessionState || sessionData.state || "",
    };
  });
}

export function buildSessionCsv(trialsSnapshot, sessionData, sessionState, sessionId) {
  const { results, parseFailures } = expandTrialsSnapshot(trialsSnapshot);
  if (results.length === 0) {
    throw new Error("NO_RESULTS");
  }

  sortTrials(results);
  console.log(`Retrieved ${results.length} trials, ordered by clientTimestamp`);

  const dataWithMetadata = addSessionMetadata(
    results,
    sessionData,
    sessionState,
    sessionId,
  );
  const allFields = Array.from(
    new Set(dataWithMetadata.flatMap((row) => Object.keys(row))),
  );
  const parser = new Parser({ fields: allFields });

  try {
    const finalCsv = parser.parse(dataWithMetadata);
    return { finalCsv, results, parseFailures, allFields, dataWithMetadata };
  } catch (err) {
    throw new Error("Error converting results to CSV: " + err.message);
  }
}
