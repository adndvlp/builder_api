export default {
  id: "dropbox",
  tokensFieldName: "dropboxTokens",
  config: {
    clientId: process.env.DROPBOX_CLIENT_ID,
    clientSecret: process.env.DROPBOX_CLIENT_SECRET,
    tokenUrl: "https://api.dropbox.com/oauth2/token",
  },
};
