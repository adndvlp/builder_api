import fetch from "../../../utils/fetch-with-timeout.js";

export async function ensureExpBuilderProject(accessToken) {
  // Crear proyecto "ExpBuilder" si no existe; reusarlo si ya está creado
  let osfProjectId = null;
  try {
    // 1) Buscar proyecto existente con title === "ExpBuilder"
    const listResponse = await fetch(
      "https://api.osf.io/v2/users/me/nodes/?filter[title]=ExpBuilder",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (listResponse.ok) {
      const listData = await listResponse.json();
      const existing = listData.data?.find(
        (n) => n.attributes?.title === "ExpBuilder",
      );
      if (existing) {
        osfProjectId = existing.id;
        console.log("OSF OAuth: Reusing existing ExpBuilder project:", osfProjectId);
      }
    }

    // 2) Si no existe, crearlo
    if (!osfProjectId) {
      console.log("OSF OAuth: Creating ExpBuilder project...");
      const projectResponse = await fetch(
        "https://api.osf.io/v2/nodes/?region=us",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            data: {
              type: "nodes",
              attributes: {
                title: "ExpBuilder",
                category: "project",
                description: "Experiment Builder data storage",
                public: false,
              },
            },
          }),
        },
      );

      if (projectResponse.ok) {
        const projectData = await projectResponse.json();
        osfProjectId = projectData.data.id;
        console.log("OSF OAuth: ExpBuilder project created:", osfProjectId);
      } else {
        const errorData = await projectResponse.json();
        console.warn(
          "OSF OAuth: Could not create project:",
          errorData.errors?.[0]?.detail,
        );
      }
    }
  } catch (projectError) {
    console.warn("OSF OAuth: Error ensuring project:", projectError.message);
  }

  return osfProjectId;
}
