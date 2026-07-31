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

describe("handleProviderChange", () => {
  test("returns ok immediately when provider is unchanged", async () => {
    const experimentRef = fs.getRef("experiments/EID");

    await expect(
      handleProviderChange(
        experimentRef,
        { storageProvider: "dropbox" },
        "dropbox",
        "u1",
        "repo",
      ),
    ).resolves.toEqual({ ok: true });

    expect(experimentRef.update).not.toHaveBeenCalled();
    expect(mockGetValidToken).not.toHaveBeenCalled();
  });

  test("switches Dropbox to Drive, creates the new folder and cleans old Dropbox state", async () => {
    const experimentRef = fs.getRef("experiments/EID");
    mockGetValidToken
      .mockResolvedValueOnce({ success: true, access_token: "drive-token" })
      .mockResolvedValueOnce({ success: true, access_token: "dropbox-token" });
    mockCreateFolder.mockResolvedValueOnce({
      success: true,
      folderId: "drive-folder-id",
    });
    mockDeleteFolder.mockResolvedValueOnce({ success: true });

    await expect(
      handleProviderChange(
        experimentRef,
        {
          storageProvider: "dropbox",
          dropboxFolder: "/ExpBuilder/repo-old",
        },
        "googledrive",
        "u1",
        "repo",
      ),
    ).resolves.toEqual({ ok: true });

    expect(mockCreateFolder).toHaveBeenCalledWith(
      "googledrive",
      "drive-token",
      "/ExpBuilder/repo",
      "repo",
    );
    expect(mockDeleteFolder).toHaveBeenCalledWith(
      "dropbox",
      "dropbox-token",
      "/ExpBuilder/repo-old",
    );
    expect(experimentRef.update).toHaveBeenCalledWith({
      storageProvider: "googledrive",
    });
    expect(experimentRef.update).toHaveBeenCalledWith({
      driveFolderPath: "/ExpBuilder/repo",
      driveFolderId: "drive-folder-id",
    });
    expect(experimentRef.update).toHaveBeenCalledWith({ dropboxFolder: null });
  });

  test("switches to OSF using an existing user osfProjectId", async () => {
    const experimentRef = fs.getRef("experiments/EID");
    fs.getRef("users/u1").get.mockResolvedValueOnce(
      makeDocSnapshot({ id: "u1", data: { osfProjectId: "proj-existing" } }),
    );
    mockGetValidToken
      .mockResolvedValueOnce({ success: true, access_token: "osf-token" })
      .mockResolvedValueOnce({ success: false, error: "old token gone" });
    mockCreateFolder.mockResolvedValueOnce({
      success: true,
      componentId: "component-1",
      uploadLink: "https://files.osf.io/upload",
    });

    await expect(
      handleProviderChange(
        experimentRef,
        {
          storageProvider: "googledrive",
          driveFolderId: "old-drive-folder",
        },
        "osf",
        "u1",
        "repo",
      ),
    ).resolves.toEqual({ ok: true });

    expect(mockCreateFolder).toHaveBeenCalledWith(
      "osf",
      "osf-token",
      "proj-existing",
      "repo",
    );
    expect(mockDeleteFolder).not.toHaveBeenCalled();
    expect(experimentRef.update).toHaveBeenCalledWith({
      osfComponentId: "component-1",
      osfUploadLink: "https://files.osf.io/upload",
    });
    expect(experimentRef.update).toHaveBeenCalledWith({
      driveFolderPath: null,
      driveFolderId: null,
    });
  });

  test("returns a 400 response contract when OSF project cannot be resolved", async () => {
    const experimentRef = fs.getRef("experiments/EID");
    fs.getRef("users/u1").get.mockResolvedValueOnce(
      makeDocSnapshot({ id: "u1", exists: false }),
    );
    mockGetValidToken.mockResolvedValueOnce({
      success: true,
      access_token: "osf-token",
    });

    const result = await handleProviderChange(
      experimentRef,
      { storageProvider: "googledrive" },
      "osf",
      "u1",
      "repo",
    );

    expect(result).toEqual({
      ok: false,
      response: {
        status: 400,
        body: {
          success: false,
          message:
            "Could not resolve OSF projectId for user. Cannot switch experiment to OSF without a valid OSF project.",
        },
      },
    });
    expect(mockCreateFolder).not.toHaveBeenCalled();
  });
});
