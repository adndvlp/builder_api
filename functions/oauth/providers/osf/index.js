export default {
  id: "osf",
  tokensFieldName: "osfTokens",
  config: {
    clientId: process.env.OSF_CLIENT_ID,
    clientSecret: process.env.OSF_CLIENT_SECRET,
    tokenUrl: "https://accounts.osf.io/oauth2/token",
  },
};
