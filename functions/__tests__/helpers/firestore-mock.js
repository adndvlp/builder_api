/**
 * Reusable in-memory Firestore mock for ESM Jest tests.
 *
 * Each call to `db.collection(name).doc(id)` returns the SAME ref object for
 * a given path so tests can attach expectations to a single mock.
 *
 * Usage:
 *   const { db, getRef, makeReq, makeRes } = makeFsMock();
 *   const expRef = getRef("experiments/EID");
 *   expRef.get.mockResolvedValueOnce({ exists: true, data: () => ({...}) });
 */
import { jest } from "@jest/globals";

export function makeFsMock() {
  const refsByPath = new Map();
  const colsByPath = new Map();

  function getRef(path) {
    if (!refsByPath.has(path)) {
      const ref = {
        id: path.split("/").pop(),
        path,
        get: jest.fn(),
        set: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      };
      // Self-reference so `snapshot.docs[i].ref` patterns work
      ref.ref = ref;
      // Subcollection access — cached so repeated `.collection(name)` returns same mock
      ref.collection = jest.fn((subname) => getCol(`${path}/${subname}`));
      refsByPath.set(path, ref);
    }
    return refsByPath.get(path);
  }

  function getCol(path) {
    if (!colsByPath.has(path)) {
      const col = {
        path,
        doc: jest.fn((id) => getRef(`${path}/${id ?? `auto_${Math.random().toString(36).slice(2, 10)}`}`)),
        get: jest.fn(),
        add: jest.fn(),
      };
      // Pagination methods return self so chained `.limit(n).get()` works.
      col.limit = jest.fn(() => col);
      col.where = jest.fn(() => col);
      col.orderBy = jest.fn(() => col);
      col.startAfter = jest.fn(() => col);
      colsByPath.set(path, col);
    }
    return colsByPath.get(path);
  }

  const db = {
    collection: jest.fn((name) => getCol(name)),
    batch: jest.fn(() => makeBatchMock()),
    runTransaction: jest.fn(async (fn) => {
      const t = {
        get: jest.fn(async (ref) => await ref.get()),
        set: jest.fn((ref, data, opts) => ref.set(data, opts)),
        update: jest.fn((ref, data) => ref.update(data)),
        delete: jest.fn((ref) => ref.delete()),
      };
      return await fn(t);
    }),
  };

  function makeBatchMock() {
    const ops = [];
    return {
      set: jest.fn((ref, data, opts) => {
        ops.push({ type: "set", ref, data, opts });
      }),
      update: jest.fn((ref, data) => {
        ops.push({ type: "update", ref, data });
      }),
      delete: jest.fn((ref) => {
        ops.push({ type: "delete", ref });
      }),
      commit: jest.fn().mockResolvedValue(undefined),
      __ops: ops,
    };
  }

  return { db, getRef, getCol, refsByPath, colsByPath };
}

export function makeReq({ body = {}, query = {}, method = "POST", headers = {} } = {}) {
  return { body, query, method, headers, get: (h) => headers[h.toLowerCase()] };
}

export function makeRes() {
  const res = {
    statusCode: null,
    jsonBody: null,
    sentBody: null,
    headers: {},
  };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.jsonBody = body;
    return res;
  });
  res.send = jest.fn((body) => {
    res.sentBody = body;
    return res;
  });
  res.set = jest.fn((k, v) => {
    res.headers[k] = v;
    return res;
  });
  res.setHeader = jest.fn((k, v) => {
    res.headers[k] = v;
    return res;
  });
  res.redirect = jest.fn((url) => {
    res.statusCode = 302;
    res.sentBody = url;
    return res;
  });
  return res;
}

/**
 * Build a Firestore Admin-shaped document snapshot for document `get()` calls.
 * In the Admin SDK, `exists` is a boolean property while `data()` returns the
 * stored object or undefined for a missing document.
 */
export function makeDocSnapshot({ id = "doc", data, exists = true, ref } = {}) {
  return {
    id,
    exists,
    data: () => (exists ? data : undefined),
    ref: ref || { id },
  };
}

/**
 * Build a Firestore-shaped snapshot for collection `get()` calls.
 * Pass an array of { id, data } objects.
 */
export function makeSnapshot(docs) {
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map(({ id, data }) => ({
      id,
      exists: true,
      data: () => data,
      ref: { id, delete: jest.fn().mockResolvedValue(undefined) },
    })),
    forEach(cb) {
      this.docs.forEach(cb);
    },
  };
}
