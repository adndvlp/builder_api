import validateCSV from "../../../experiment/sessions/validation/validate-csv.js";

describe("validateCSV — Misc-3 envelope { valid, reason?, missingFields? }", () => {
  test("returns {valid:true} when all required headers present", () => {
    const csv = "trial_type,rt,response\nfoo,500,a";
    expect(validateCSV(csv, ["trial_type", "rt"])).toEqual({ valid: true });
  });

  test("MISSING_FIELDS reason + list when a required header is absent", () => {
    const csv = "rt,response\n500,a";
    const r = validateCSV(csv, ["trial_type", "rt"]);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("MISSING_FIELDS");
    expect(r.missingFields).toEqual(["trial_type"]);
  });

  test("EMPTY_CSV reason for empty string", () => {
    expect(validateCSV("", ["trial_type"])).toEqual({
      valid: false,
      reason: "EMPTY_CSV",
    });
  });

  test("EMPTY_CSV reason for non-string input", () => {
    expect(validateCSV(undefined, ["x"])).toEqual({
      valid: false,
      reason: "EMPTY_CSV",
    });
    expect(validateCSV(null, ["x"])).toEqual({
      valid: false,
      reason: "EMPTY_CSV",
    });
  });

  test("vacuous: returns {valid:true} when requiredFields empty (valid CSV)", () => {
    expect(validateCSV("anything,here", [])).toEqual({ valid: true });
  });

  test("only inspects header row (documented behavior)", () => {
    const csv = "trial_type,rt\nfoo";
    expect(validateCSV(csv, ["trial_type"])).toEqual({ valid: true });
  });
});
