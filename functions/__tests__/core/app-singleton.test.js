import { jest } from "@jest/globals";

const mockApp = { name: "default-app" };
const mockDb = { type: "firestore" };
const mockInitializeApp = jest.fn(() => mockApp);
const mockGetFirestore = jest.fn(() => mockDb);

jest.unstable_mockModule("firebase-admin/app", () => ({
  initializeApp: mockInitializeApp,
}));
jest.unstable_mockModule("firebase-admin/firestore", () => ({
  getFirestore: mockGetFirestore,
}));

const { app, db } = await import("../../app.js");

describe("app singleton", () => {
  test("initializes Firebase Admin once and creates Firestore from that app", () => {
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockGetFirestore).toHaveBeenCalledWith(mockApp);
    expect(app).toBe(mockApp);
    expect(db).toBe(mockDb);
  });
});
