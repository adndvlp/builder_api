import CSV from "csv-string";
import {
  deserializeFromFirestore,
  mergeCsvByColumns,
} from "../../../experiment/sessions/validation/serialize.js";

describe("deserializeFromFirestore", () => {
  test("returns null and undefined unchanged", () => {
    expect(deserializeFromFirestore(null)).toBeNull();
    expect(deserializeFromFirestore(undefined)).toBeUndefined();
  });

  test("decodes only the { __json } sentinel shape", () => {
    expect(deserializeFromFirestore({ __json: "{\"a\":1}" })).toEqual({
      a: 1,
    });
    expect(
      deserializeFromFirestore({
        nested: { __json: "[1,2]" },
        literal: "[not decoded]",
      }),
    ).toEqual({
      nested: [1, 2],
      literal: "[not decoded]",
    });
  });

  test("leaves non-sentinel objects, arrays and malformed sentinel JSON safe", () => {
    expect(deserializeFromFirestore({ __json: "{\"a\":1}", extra: true })).toEqual({
      __json: "{\"a\":1}",
      extra: true,
    });
    expect(deserializeFromFirestore([{ __json: "{\"a\":1}" }])).toEqual([
      { __json: "{\"a\":1}" },
    ]);
    expect(deserializeFromFirestore({ __json: "{bad json" })).toBe("{bad json");
  });
});

describe("mergeCsvByColumns", () => {
  test("returns the non-empty CSV when either side has no data rows", () => {
    const existing = CSV.stringify([
      ["a", "b"],
      ["1", "2"],
    ]);
    const incoming = CSV.stringify([["a", "b"]]);

    expect(mergeCsvByColumns("", existing)).toBe(existing);
    expect(mergeCsvByColumns(existing, incoming)).toBe(existing);
  });

  test("unions headers, preserves row order and fills missing cells", () => {
    const existing = CSV.stringify([
      ["trial", "rt"],
      ["1", "100"],
    ]);
    const incoming = CSV.stringify([
      ["trial", "response"],
      ["2", "left"],
    ]);

    const merged = mergeCsvByColumns(existing, incoming);

    expect(CSV.parse(merged)).toEqual([
      ["trial", "rt", "response"],
      ["1", "100", ""],
      ["2", "", "left"],
    ]);
  });

  test("preserves new-only columns in their incoming order", () => {
    const existing = CSV.stringify([
      ["a"],
      ["1"],
    ]);
    const incoming = CSV.stringify([
      ["c", "b", "a"],
      ["3", "2", "1-new"],
    ]);

    expect(CSV.parse(mergeCsvByColumns(existing, incoming))[0]).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
});
