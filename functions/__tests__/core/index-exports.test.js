import { jest } from "@jest/globals";

const apiData = jest.fn();
const apiDataComplete = jest.fn();
const finalizeDisconnectedSessions = jest.fn();
const processSessionTimeout = jest.fn();
const publishExperiment = jest.fn();
const apiDeleteExperiment = jest.fn();
const apiCondition = jest.fn();
const dropboxOAuthCallback = jest.fn();
const githubOAuthCallback = jest.fn();
const googleDriveOAuthCallback = jest.fn();
const osfOAuthCallback = jest.fn();
const osfManage = jest.fn();
const createOAuthStateEndpoint = jest.fn();
const uploadParticipantFile = jest.fn();
const mockSetGlobalOptions = jest.fn();

jest.unstable_mockModule("../../experiment/sessions/index.js", () => ({
  apiData,
  apiDataComplete,
  finalizeDisconnectedSessions,
}));
jest.unstable_mockModule("../../experiment/sessions/timeout/tasks.js", () => ({
  processSessionTimeout,
}));
jest.unstable_mockModule("../../experiment/index.js", () => ({
  publishExperiment,
  apiDeleteExperiment,
}));
jest.unstable_mockModule("../../experiment/api/condition.js", () => ({
  apiCondition,
}));
jest.unstable_mockModule("../../oauth/api/callbacks/dropbox.js", () => ({
  dropboxOAuthCallback,
}));
jest.unstable_mockModule("../../oauth/api/callbacks/github.js", () => ({
  githubOAuthCallback,
}));
jest.unstable_mockModule("../../oauth/api/callbacks/google-drive.js", () => ({
  googleDriveOAuthCallback,
}));
jest.unstable_mockModule("../../oauth/api/callbacks/osf.js", () => ({
  osfOAuthCallback,
}));
jest.unstable_mockModule("../../oauth/api/osf-manage.js", () => ({
  osfManage,
}));
jest.unstable_mockModule("../../oauth/api/state.js", () => ({
  createOAuthStateEndpoint,
}));
jest.unstable_mockModule("../../experiment/participant-files/api/upload.js", () => ({
  uploadParticipantFile,
}));
jest.unstable_mockModule("firebase-functions/v2", () => ({
  setGlobalOptions: mockSetGlobalOptions,
}));

const entrypoints = await import("../../index.js");

describe("functions/index.js", () => {
  test("sets global function options and re-exports public Cloud Functions", () => {
    expect(mockSetGlobalOptions).toHaveBeenCalledWith({ maxInstances: 20 });
    expect(entrypoints).toMatchObject({
      apiData,
      apiDataComplete,
      apiDeleteExperiment,
      apiCondition,
      finalizeDisconnectedSessions,
      processSessionTimeout,
      dropboxOAuthCallback,
      githubOAuthCallback,
      publishExperiment,
      googleDriveOAuthCallback,
      osfManage,
      osfOAuthCallback,
      createOAuthStateEndpoint,
      uploadParticipantFile,
    });
  });
});
