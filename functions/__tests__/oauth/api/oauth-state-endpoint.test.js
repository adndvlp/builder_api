import { jest } from "@jest/globals";
import { makeReq, makeRes } from "../../helpers/firestore-mock.js";

const mockRequireAuth = jest.fn();
const mockCreateOAuthState = jest.fn();

jest.unstable_mockModule("firebase-functions/v2/https", () => ({
  onRequest: (...args) => args[args.length - 1],
}));
jest.unstable_mockModule("../../../utils/auth.js", () => ({
  requireAuth: mockRequireAuth,
}));
jest.unstable_mockModule("../../../oauth/state-service.js", () => ({
  createOAuthState: mockCreateOAuthState,
}));

const { createOAuthStateEndpoint } = await import("../../../oauth/api/state.js");

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockCreateOAuthState.mockReset();
});

describe("createOAuthStateEndpoint", () => {
  test("OPTIONS preflight returns 204", async () => {
    const res = makeRes();

    await createOAuthStateEndpoint(makeReq({ method: "OPTIONS" }), res);

    expect(res.statusCode).toBe(204);
    expect(res.sentBody).toBe("");
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  test("rejects non-POST requests", async () => {
    const res = makeRes();

    await createOAuthStateEndpoint(makeReq({ method: "GET" }), res);

    expect(res.statusCode).toBe(405);
    expect(res.jsonBody).toEqual({
      success: false,
      message: "Method not allowed",
    });
  });

  test("stops when Firebase auth fails", async () => {
    mockRequireAuth.mockResolvedValueOnce(null);
    const req = makeReq({ body: { provider: "github" } });
    const res = makeRes();

    await createOAuthStateEndpoint(req, res);

    expect(mockRequireAuth).toHaveBeenCalledWith(req, res, {
      requireMatchingUid: false,
    });
    expect(mockCreateOAuthState).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("validates provider before minting state", async () => {
    mockRequireAuth.mockResolvedValueOnce("u1");
    const res = makeRes();

    await createOAuthStateEndpoint(
      makeReq({ body: { provider: "unknown" } }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody.message).toMatch(/provider must be one of/);
    expect(mockCreateOAuthState).not.toHaveBeenCalled();
  });

  test("returns the JsPsych client contract: { success: true, state }", async () => {
    mockRequireAuth.mockResolvedValueOnce("u1");
    mockCreateOAuthState.mockReturnValueOnce("signed-state");
    const res = makeRes();

    await createOAuthStateEndpoint(makeReq({ body: { provider: "github" } }), res);

    expect(mockCreateOAuthState).toHaveBeenCalledWith("u1", "github");
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ success: true, state: "signed-state" });
  });

  test("masks createOAuthState failures behind a generic 500", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRequireAuth.mockResolvedValueOnce("u1");
    mockCreateOAuthState.mockImplementationOnce(() => {
      throw new Error("secret missing");
    });
    const res = makeRes();

    await createOAuthStateEndpoint(makeReq({ body: { provider: "osf" } }), res);

    expect(errorSpy).toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({
      success: false,
      message: "Internal server error",
    });
  });
});
