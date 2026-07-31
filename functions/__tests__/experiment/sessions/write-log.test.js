/**
 * Tests for experiment/sessions/write-log.js — generic action counter writer.
 * Covers: noop on missing params, success path (T-16 generic action), error swallow.
 */
import { jest } from "@jest/globals";
import { makeFsMock } from "../../helpers/firestore-mock.js";

const fs = makeFsMock();

jest.unstable_mockModule("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (n) => ({ __op: "increment", value: n }),
    serverTimestamp: () => ({ __op: "serverTimestamp" }),
  },
}));
jest.unstable_mockModule("../../../app.js", () => ({ db: fs.db }));

const { default: writeLog } = await import("../../../experiment/sessions/logging/write-log.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
});

describe("writeLog", () => {
  test("Misc-2 FIX: noop (no Firestore call) when experimentID missing — returns void", async () => {
    const r = await writeLog(null, "createExperiment");
    expect(r).toBeUndefined();
    expect(fs.db.collection).not.toHaveBeenCalled();
  });

  test("Misc-2 FIX: noop (no Firestore call) when action missing — returns void", async () => {
    const r = await writeLog("EID", null);
    expect(r).toBeUndefined();
    expect(fs.db.collection).not.toHaveBeenCalled();
  });

  test("T-16: writes increment(1) under the given action key (generic, not hardcoded)", async () => {
    await writeLog("EID", "finishSession");
    const ref = fs.getRef("logs/EID");
    expect(ref.set).toHaveBeenCalledTimes(1);
    const [body, opts] = ref.set.mock.calls[0];
    expect(body).toEqual({
      finishSession: { __op: "increment", value: 1 },
    });
    expect(opts).toEqual({ merge: true });
  });

  test("T-16: arbitrary action key is honored (e.g. a brand-new action)", async () => {
    await writeLog("EID", "brandNewAction_v2");
    const body = fs.getRef("logs/EID").set.mock.calls[0][0];
    expect(body).toHaveProperty("brandNewAction_v2");
  });

  test("Misc-2 FIX: swallows Firestore errors silently (no throw, no boolean)", async () => {
    const ref = fs.getRef("logs/EID");
    ref.set.mockRejectedValueOnce(new Error("permission denied"));

    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await writeLog("EID", "createExperiment");
    expect(r).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
