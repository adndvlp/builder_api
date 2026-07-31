export default {
  id: "googledrive",
  tokensFieldName: "googleDriveTokens",
  config: {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
};
