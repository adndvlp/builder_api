import { db } from "../app.js";
import fetch from "node-fetch";

/**
 * Obtiene el token de GitHub de un usuario
 * @param {string} uid - ID del usuario
 * @returns {Promise<Object>} - Objeto con el token de acceso o error
 */
async function getGithubToken(uid) {
  try {
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return {
        success: false,
        error: "User not found",
      };
    }

    const userData = userDoc.data();
    const githubTokens = userData.githubTokens;

    if (!githubTokens || !githubTokens.access_token) {
      return {
        success: false,
        error: "No GitHub token found for user",
      };
    }

    return {
      success: true,
      access_token: githubTokens.access_token,
    };
  } catch (error) {
    console.error("Error getting GitHub token:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Obtiene el owner (username) de GitHub del usuario
 */
async function getGithubOwner(accessToken) {
  const userResponse = await fetch("https://api.github.com/user", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  const userData = await userResponse.json();

  if (!userResponse.ok) {
    throw new Error(
      userData.message || "Error getting GitHub user information",
    );
  }

  return userData.login;
}

export { getGithubToken, getGithubOwner };
