// Next.js API route que hace proxy a la Cloud Function de Firebase
export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state parameter" });
  }

  try {
    // Determinar la URL de la Cloud Function según el entorno
    const isDev = process.env.NODE_ENV === "development";
    const cloudFunctionUrl = isDev
      ? `http://127.0.0.1:5001/osf-relay/us-central1/dropboxOAuthCallback`
      : `https://us-central1-osf-relay.cloudfunctions.net/dropboxOAuthCallback`;

    console.log("Calling Cloud Function:", cloudFunctionUrl);
    console.log("With params - code:", code, "state:", state);

    // Llamar a la Cloud Function
    const response = await fetch(
      `${cloudFunctionUrl}?code=${encodeURIComponent(
        code
      )}&state=${encodeURIComponent(state)}`
    );

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response:", errorText);
      return res.status(response.status).send(errorText);
    }

    const result = await response.text();
    console.log("Success:", result);
    return res.status(200).send(result);
  } catch (error) {
    console.error("Error calling Cloud Function:", error);
    return res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
}
