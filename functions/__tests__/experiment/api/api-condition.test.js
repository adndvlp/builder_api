/**
 * Tests for experiment/api-condition.js — round-robin condition assignment.
 * Covers: validation, exp-not-found, flag off, single-condition fast path,
 * transactional rotate, transaction error 400.
 */
import { jest } from "@jest/globals";
import { makeFsMock, makeReq, makeRes } from "../../helpers/firestore-mock.js";

const fs = makeFsMock();
const mockWriteLog = jest.fn().mockResolvedValue(true);

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
}));
jest.unstable_mockModule("../../../app.js", () => ({ db: fs.db }));
jest.unstable_mockModule("../../../experiment/sessions/logging/write-log.js", () => ({
  default: mockWriteLog,
}));

const { apiCondition } = await import("../../../experiment/api/condition.js");

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  fs.db.runTransaction.mockClear();
  mockWriteLog.mockClear();
});

describe("apiCondition — validation", () => {
  test("400 MISSING_PARAMETER when experimentID absent", async () => {
    const res = makeRes();
    await apiCondition(makeReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("MISSING_PARAMETER");
    expect(mockWriteLog).not.toHaveBeenCalled();
  });
});

describe("apiCondition — error branches", () => {
  test("400 EXPERIMENT_NOT_FOUND when exp doc missing", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({ exists: false });
    const res = makeRes();
    await apiCondition(makeReq({ body: { experimentID: "EID" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("EXPERIMENT_NOT_FOUND");
    expect(mockWriteLog).toHaveBeenCalledWith("EID", "getCondition");
  });

  test("400 CONDITION_ASSIGNMENT_NOT_ACTIVE when flag off", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ activeConditionAssignment: false }),
    });
    const res = makeRes();
    await apiCondition(makeReq({ body: { experimentID: "EID" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("CONDITION_ASSIGNMENT_NOT_ACTIVE");
  });
});

describe("apiCondition — success paths", () => {
  test("nConditions=1 short-circuits: returns condition 0 without transaction", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ activeConditionAssignment: true, nConditions: 1 }),
    });
    const res = makeRes();
    await apiCondition(makeReq({ body: { experimentID: "EID" } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ message: "Success", condition: 0 });
    expect(fs.db.runTransaction).not.toHaveBeenCalled();
  });

  test("nConditions>1 returns currentCondition and increments via transaction (round-robin)", async () => {
    const ref = fs.getRef("experiments/EID");
    // initial get (outside txn)
    ref.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ activeConditionAssignment: true, nConditions: 3 }),
    });
    // get inside transaction
    ref.get.mockResolvedValueOnce({
      data: () => ({ currentCondition: 2, nConditions: 3 }),
    });

    const res = makeRes();
    await apiCondition(makeReq({ body: { experimentID: "EID" } }), res);

    expect(res.statusCode).toBe(200);
    // returns the value seen BEFORE rotation
    expect(res.jsonBody).toEqual({ message: "Success", condition: 2 });
    expect(fs.db.runTransaction).toHaveBeenCalledTimes(1);
    // set should have rotated 2 → (2+1)%3 = 0
    expect(ref.set).toHaveBeenCalledWith(
      { currentCondition: 0 },
      { merge: true },
    );
  });

  test("400 UNKNOWN_ERROR when transaction throws", async () => {
    fs.getRef("experiments/EID").get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ activeConditionAssignment: true, nConditions: 3 }),
    });
    fs.db.runTransaction.mockRejectedValueOnce(new Error("contention"));

    const res = makeRes();
    await apiCondition(makeReq({ body: { experimentID: "EID" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.error).toBe("UNKNOWN_ERROR_GETTING_CONDITION");
  });
});
