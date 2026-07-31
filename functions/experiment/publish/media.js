import { uploadFileGithub } from "../hosting/services.js";

/**
 * E-10: parallel uploads with a small concurrency cap (GitHub rate limit
 * is 5000 req/hr; we batch 5-wide to stay well under and still cut
 * wall-clock by ~5x for media-heavy publishes).
 * E-11: collect per-file success/error and include in the response so
 * the client can surface failures instead of silently dropping them.
 */
const FOLDER_BY_TYPE = { img: "img", vid: "vid", aud: "aud" };
const CONCURRENCY = 5;

export async function uploadMediaFiles(
  accessToken,
  owner,
  repoName,
  mediaFiles,
) {
  if (!mediaFiles || !Array.isArray(mediaFiles)) return [];
  console.log(`Uploading ${mediaFiles.length} media files...`);

  const eligibleFiles = mediaFiles.filter(
    (f) =>
      f &&
      f.type &&
      f.filename &&
      f.content &&
      FOLDER_BY_TYPE[f.type] !== undefined,
  );

  const results = [];
  for (let i = 0; i < eligibleFiles.length; i += CONCURRENCY) {
    const batch = eligibleFiles.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (file) => {
        const filePath = `${FOLDER_BY_TYPE[file.type]}/${file.filename}`;
        let fileContent = file.content;
        if (typeof fileContent === "string") {
          const base64Part = fileContent.includes(",")
            ? fileContent.split(",")[1]
            : fileContent;
          fileContent = Buffer.from(base64Part, "base64");
        }
        try {
          const r = await uploadFileGithub(
            accessToken,
            owner,
            repoName,
            filePath,
            fileContent,
            `Upload ${file.type} file: ${file.filename}`,
          );
          if (!r.success) {
            console.warn(
              `Error uploading media file ${file.filename}:`,
              r.errorText,
            );
          } else {
            console.log(`Media file uploaded: ${filePath}`);
          }
          return {
            filename: file.filename,
            success: r.success,
            ...(r.success ? {} : { error: r.errorText }),
          };
        } catch (err) {
          console.error(`Media upload threw for ${file.filename}:`, err);
          return {
            filename: file.filename,
            success: false,
            error: err.message,
          };
        }
      }),
    );
    results.push(...settled);
  }
  return results;
}
