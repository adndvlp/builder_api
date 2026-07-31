import { getParticipantFileProvider } from "./provider-registry.js";

export async function uploadFileToBucket(
  provider,
  token,
  expData,
  filename,
  buffer,
  mimeType,
) {
  const impl = getParticipantFileProvider(provider);
  if (!impl) throw new Error(`Unsupported storage provider: ${provider}`);
  return impl.uploadFile({ token, expData, filename, buffer, mimeType });
}
