import { jest } from "@jest/globals";
import {
  makeDocSnapshot,
  makeFsMock,
} from "../../helpers/firestore-mock.js";

const fs = makeFsMock();
const mockGetValidToken = jest.fn();
const mockFetch = jest.fn();
const mockCreateExperiment = jest.fn();
const mockCreateFolder = jest.fn();
const mockDeleteFolder = jest.fn();

jest.unstable_mockModule("../../../app.js", () => ({ db: fs.db, app: {} }));
jest.unstable_mockModule("../../../oauth/index.js", () => ({
  getValidToken: mockGetValidToken,
}));
jest.unstable_mockModule("../../../utils/fetch-with-timeout.js", () => ({
  default: mockFetch,
}));
jest.unstable_mockModule("../../../experiment/create.js", () => ({
  createExperiment: mockCreateExperiment,
}));
jest.unstable_mockModule("../../../experiment/sessions/services/folder.js", () => ({
  createFolder: mockCreateFolder,
  deleteFolder: mockDeleteFolder,
}));

const { createExperimentIfMissing } = await import(
  "../../../experiment/publish/create-if-missing.js"
);
const { handleProviderChange } = await import(
  "../../../experiment/publish/provider-change.js"
);

beforeEach(() => {
  fs.refsByPath.clear();
  fs.colsByPath.clear();
  fs.db.collection.mockClear();
  mockGetValidToken.mockReset();
  mockFetch.mockReset();
  mockCreateExperiment.mockReset();
  mockDeleteFolder.mockReset();
  mockCreateFolder.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("createExperimentIfMissing", () => {
  test("defaults missing storageProvider to googledrive and creates the experiment", async () => {
    mockCreateExperiment.mockResolvedValueOnce({ success: true });

    await createExperimentIfMissing("EID", "repo", "u1");

    expect(mockGetValidToken).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreateExperiment).toHaveBeenCalledWith(
      "EID",
      "repo",
      "u1",
      "googledrive",
    );
  });

  test("for OSF, creates and stores an ExpBuilder project when the user lacks one", async () => {
    const userRef = fs.getRef("users/u1");
    userRef.get.mockResolvedValueOnce(
      makeDocSnapshot({ id: "u1", data: { osfProjectId: "" } }),
    );
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "osf-token",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { id: "proj-new" } }),
    });
    mockCreateExperiment.mockResolvedValueOnce({ success: true });

    await createExperimentIfMissing("EID", "repo", "u1", "osf");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.osf.io/v2/nodes/?region=us",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer osf-token",
        }),
      }),
    );
    expect(userRef.update).toHaveBeenCalledWith({ osfProjectId: "proj-new" });
    expect(mockCreateExperiment).toHaveBeenCalledWith("EID", "repo", "u1", "osf");
  });

  test("skips OSF project creation when token validation fails but still creates experiment", async () => {
    fs.getRef("users/u1").get.mockResolvedValueOnce(
      makeDocSnapshot({ id: "u1", data: {} }),
    );
    mockGetValidToken.mockResolvedValueOnce({ success: false });
    mockCreateExperiment.mockResolvedValueOnce({ success: true });

    await createExperimentIfMissing("EID", "repo", "u1", "osf");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreateExperiment).toHaveBeenCalledWith("EID", "repo", "u1", "osf");
  });

  test("does not block publishing when experiment creation throws", async () => {
    mockCreateExperiment.mockRejectedValueOnce(new Error("firestore down"));

    await expect(
      createExperimentIfMissing("EID", "repo", "u1", "dropbox"),
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      "Warning: Could not create experiment in Firestore:",
      "firestore down",
    );
  });
});
