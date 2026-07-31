import { jest } from "@jest/globals";

const createExperiment = jest.fn();
const deleteExperiment = jest.fn();
const apiDeleteExperiment = jest.fn();
const publishExperiment = jest.fn();

const apiData = jest.fn();
const apiDataComplete = jest.fn();
const finalizeSession = jest.fn();
const finalizeDisconnectedSessions = jest.fn();

const handleCreateSession = jest.fn();
const handleAppendResult = jest.fn();
const handleListSessions = jest.fn();
const handleDownloadSession = jest.fn();
const handleDeleteSession = jest.fn();
const getSessionFolderIdentifier = jest.fn();

const createSession = jest.fn();
const appendResult = jest.fn();
const listSessions = jest.fn();
const downloadSession = jest.fn();
const deleteSession = jest.fn();
const postFile = jest.fn();

const osfOAuthCallback = jest.fn();
const refreshOSFToken = jest.fn();
const getOSFAuthorizationUrl = jest.fn();

jest.unstable_mockModule("../../experiment/create.js", () => ({
  createExperiment,
}));
jest.unstable_mockModule("../../experiment/delete.js", () => ({
  deleteExperiment,
}));
jest.unstable_mockModule("../../experiment/api/delete.js", () => ({
  apiDeleteExperiment,
}));
jest.unstable_mockModule("../../experiment/publish/index.js", () => ({
  publishExperiment,
}));

jest.unstable_mockModule("../../experiment/sessions/api/data-router.js", () => ({
  apiData,
}));
jest.unstable_mockModule("../../experiment/sessions/api/data-complete.js", () => ({
  apiDataComplete,
}));
jest.unstable_mockModule("../../experiment/sessions/finalization/finalize.js", () => ({
  finalizeSession,
}));
jest.unstable_mockModule("../../experiment/sessions/finalization/triggers.js", () => ({
  finalizeDisconnectedSessions,
}));

jest.unstable_mockModule("../../experiment/sessions/handlers/create-session.js", () => ({
  handleCreateSession,
}));
jest.unstable_mockModule("../../experiment/sessions/handlers/append-result.js", () => ({
  handleAppendResult,
}));
jest.unstable_mockModule("../../experiment/sessions/handlers/list-sessions.js", () => ({
  handleListSessions,
}));
jest.unstable_mockModule("../../experiment/sessions/handlers/download-session.js", () => ({
  handleDownloadSession,
}));
jest.unstable_mockModule("../../experiment/sessions/handlers/delete-session.js", () => ({
  handleDeleteSession,
}));
jest.unstable_mockModule("../../experiment/sessions/handlers/helpers.js", () => ({
  getSessionFolderIdentifier,
}));

jest.unstable_mockModule("../../experiment/sessions/storage/index.js", () => ({
  createSession,
  appendResult,
  listSessions,
  downloadSession,
  deleteSession,
  postFile,
}));

jest.unstable_mockModule("../../oauth/providers/osf/callback.js", () => ({
  osfOAuthCallback,
}));
jest.unstable_mockModule("../../oauth/providers/osf/refresh.js", () => ({
  refreshOSFToken,
}));
jest.unstable_mockModule("../../oauth/providers/osf/authorization-url.js", () => ({
  getOSFAuthorizationUrl,
}));

const experiment = await import("../../experiment/index.js");
const sessions = await import("../../experiment/sessions/index.js");
const handler = await import("../../experiment/sessions/handler.js");
const storage = await import("../../experiment/sessions/storage.js");
const osfCallbacks = await import("../../oauth/api/callbacks/osf.js");

describe("module re-export contracts", () => {
  test("experiment/index.js re-exports experiment entry points", () => {
    expect(experiment).toMatchObject({
      createExperiment,
      deleteExperiment,
      apiDeleteExperiment,
      publishExperiment,
    });
  });

  test("sessions/index.js re-exports public session entry points", () => {
    expect(sessions).toMatchObject({
      apiData,
      apiDataComplete,
      finalizeSession,
      finalizeDisconnectedSessions,
    });
  });

  test("sessions/handler.js re-exports split handler modules", () => {
    expect(handler).toMatchObject({
      handleCreateSession,
      handleAppendResult,
      handleListSessions,
      handleDownloadSession,
      handleDeleteSession,
      getSessionFolderIdentifier,
    });
  });

  test("sessions/storage.js re-exports storage provider facade", () => {
    expect(storage).toMatchObject({
      createSession,
      appendResult,
      listSessions,
      downloadSession,
      deleteSession,
      postFile,
    });
  });

  test("oauth/callbacks/osf.js re-exports OSF callback helpers", () => {
    expect(osfCallbacks).toMatchObject({
      osfOAuthCallback,
      refreshOSFToken,
      getOSFAuthorizationUrl,
    });
  });
});
