import { getHostingProvider } from "../../experiment/hosting/provider-registry.js";
import { getParticipantFileProvider } from "../../experiment/participant-files/provider-registry.js";
import { getSessionStorageProvider } from "../../experiment/sessions/storage/provider-registry.js";
import { getTokenProvider } from "../../oauth/token-registry.js";

const expectFunctions = (provider, methods) => {
  expect(provider).not.toBeNull();
  for (const method of methods) {
    expect(provider[method]).toEqual(expect.any(Function));
  }
};

describe("provider contracts", () => {
  test.each(["dropbox", "googledrive", "osf"])(
    "session storage provider %s implements the storage interface",
    (providerName) => {
      expectFunctions(getSessionStorageProvider(providerName), [
        "createSession",
        "appendResult",
        "listSessions",
        "downloadSession",
        "deleteSession",
        "postFile",
      ]);
    },
  );

  test.each(["dropbox", "googledrive", "osf"])(
    "participant-file provider %s implements uploadFile",
    (providerName) => {
      expectFunctions(getParticipantFileProvider(providerName), ["uploadFile"]);
    },
  );

  test("Google Drive aliases resolve to the same provider objects", () => {
    expect(getSessionStorageProvider("google-drive")).toBe(
      getSessionStorageProvider("googledrive"),
    );
    expect(getParticipantFileProvider("google-drive")).toBe(
      getParticipantFileProvider("googledrive"),
    );
    expect(getTokenProvider("google-drive")).toBe(
      getTokenProvider("googledrive"),
    );
  });

  test("GitHub hosting implements the hosting interface", () => {
    expectFunctions(getHostingProvider("github"), [
      "createRepositoryGithub",
      "uploadFileGithub",
      "enableGithubPages",
      "deleteRepositoryGithub",
      "waitForGithubRepoReady",
      "getRepositoryInfo",
    ]);
    expect(getHostingProvider()).toBe(getHostingProvider("github"));
  });

  test.each([
    ["dropbox", "dropboxTokens"],
    ["googledrive", "googleDriveTokens"],
    ["osf", "osfTokens"],
  ])("token provider %s exposes its token contract", (providerName, field) => {
    const provider = getTokenProvider(providerName);
    expect(provider).toMatchObject({
      id: providerName,
      tokensFieldName: field,
      config: {
        tokenUrl: expect.stringMatching(/^https:\/\//),
      },
    });
    expect(provider.config).toHaveProperty("clientId");
    expect(provider.config).toHaveProperty("clientSecret");
  });

  test("unknown providers are rejected consistently", () => {
    expect(getSessionStorageProvider("unknown")).toBeNull();
    expect(getParticipantFileProvider("unknown")).toBeNull();
    expect(getHostingProvider("unknown")).toBeNull();
    expect(getTokenProvider("unknown")).toBeNull();
  });
});
