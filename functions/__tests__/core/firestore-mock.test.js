import { jest } from "@jest/globals";
import {
  makeDocSnapshot,
  makeFsMock,
  makeSnapshot,
} from "../helpers/firestore-mock.js";

describe("Firestore test doubles", () => {
  test("makeDocSnapshot mirrors the Admin document snapshot shape used by runtime code", () => {
    const ref = { id: "u1", path: "users/u1" };
    const found = makeDocSnapshot({
      id: "u1",
      data: { name: "Ada" },
      ref,
    });
    const missing = makeDocSnapshot({ id: "ghost", exists: false });

    expect(found).toMatchObject({
      id: "u1",
      exists: true,
      ref,
    });
    expect(found.data()).toEqual({ name: "Ada" });
    expect(missing.exists).toBe(false);
    expect(missing.data()).toBeUndefined();
  });

  test("makeSnapshot exposes QuerySnapshot docs, empty, size and forEach", () => {
    const snapshot = makeSnapshot([
      { id: "a", data: { n: 1 } },
      { id: "b", data: { n: 2 } },
    ]);
    const seen = [];

    snapshot.forEach((doc) => seen.push([doc.id, doc.data()]));

    expect(snapshot.empty).toBe(false);
    expect(snapshot.size).toBe(2);
    expect(snapshot.docs).toHaveLength(2);
    expect(seen).toEqual([
      ["a", { n: 1 }],
      ["b", { n: 2 }],
    ]);
    expect(snapshot.docs[0].ref.delete).toEqual(expect.any(Function));
  });

  test("makeFsMock caches document and collection refs by path", async () => {
    const { db, getRef, getCol } = makeFsMock();

    expect(db.collection("users")).toBe(getCol("users"));
    expect(db.collection("users").doc("u1")).toBe(getRef("users/u1"));
    expect(getRef("users/u1").collection("tokens").doc("github")).toBe(
      getRef("users/u1/tokens/github"),
    );
  });

  test("runTransaction delegates get/set/update/delete to the same refs", async () => {
    const { db, getRef } = makeFsMock();
    const ref = getRef("experiments/EID");
    ref.get.mockResolvedValueOnce(makeDocSnapshot({ id: "EID", data: { n: 1 } }));

    await db.runTransaction(async (tx) => {
      await expect(tx.get(ref)).resolves.toMatchObject({ exists: true });
      tx.set(ref, { n: 2 }, { merge: true });
      tx.update(ref, { n: 3 });
      tx.delete(ref);
    });

    expect(ref.set).toHaveBeenCalledWith({ n: 2 }, { merge: true });
    expect(ref.update).toHaveBeenCalledWith({ n: 3 });
    expect(ref.delete).toHaveBeenCalled();
  });

  test("batch records operations and resolves commit", async () => {
    const { db, getRef } = makeFsMock();
    const ref = getRef("experiments/EID");
    const batch = db.batch();

    batch.set(ref, { a: 1 });
    batch.update(ref, { b: 2 });
    batch.delete(ref);

    await expect(batch.commit()).resolves.toBeUndefined();
    expect(batch.__ops.map((op) => op.type)).toEqual([
      "set",
      "update",
      "delete",
    ]);
    expect(batch.__ops[0]).toMatchObject({ ref, data: { a: 1 } });
  });
});
