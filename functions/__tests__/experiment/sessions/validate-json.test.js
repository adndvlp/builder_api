import validateJSON from "../../../experiment/sessions/validation/validate-json.js";

describe("validateJSON — Misc-3 envelope { valid, reason?, missingFields? }", () => {
  test("returns {valid:true} when single object has all required fields", () => {
    const json = JSON.stringify({ trial_type: "html", rt: 500 });
    expect(validateJSON(json, ["trial_type"])).toEqual({ valid: true });
  });

  test("MISSING_FIELDS reason + list when single object missing field", () => {
    const json = JSON.stringify({ rt: 500 });
    expect(validateJSON(json, ["trial_type", "rt"])).toEqual({
      valid: false,
      reason: "MISSING_FIELDS",
      missingFields: ["trial_type"],
    });
  });

  test("PARSE_ERROR reason for non-JSON input", () => {
    expect(validateJSON("not json", ["trial_type"])).toEqual({
      valid: false,
      reason: "PARSE_ERROR",
    });
  });

  test("Misc-4: array fails MISSING_FIELDS when ANY element lacks the field", () => {
    const arr = [
      { rt: 1 },
      { trial_type: "x" },
    ];
    const r = validateJSON(JSON.stringify(arr), ["trial_type"]);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("MISSING_FIELDS");
    expect(r.missingFields).toEqual(["trial_type"]);
  });

  test("Misc-4: array passes when every element has every required field", () => {
    const arr = [
      { trial_type: "a", rt: 1 },
      { trial_type: "b", rt: 2 },
    ];
    expect(validateJSON(JSON.stringify(arr), ["trial_type"])).toEqual({
      valid: true,
    });
  });

  test("EMPTY_ARRAY reason when fields required but array empty", () => {
    expect(validateJSON("[]", [])).toEqual({ valid: true });
    const r = validateJSON("[]", ["trial_type"]);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("EMPTY_ARRAY");
    expect(r.missingFields).toEqual(["trial_type"]);
  });

  test("vacuous: returns {valid:true} when requiredFields empty", () => {
    expect(validateJSON(JSON.stringify({ a: 1 }), [])).toEqual({
      valid: true,
    });
  });

  test("NOT_OBJECT reason for primitive root", () => {
    expect(validateJSON("42", ["x"])).toEqual({
      valid: false,
      reason: "NOT_OBJECT",
    });
  });

  test("INVALID_ELEMENT reason when array contains a primitive", () => {
    expect(validateJSON(JSON.stringify([{ a: 1 }, 7]), ["a"])).toEqual({
      valid: false,
      reason: "INVALID_ELEMENT",
    });
  });
});
