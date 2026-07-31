import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Firebase Admin singleton.
 *
 * `initializeApp()` is called WITHOUT explicit credentials — Cloud Functions
 * v2 injects Application Default Credentials at runtime (service account
 * bound to the function) and the local emulator picks up
 * `FIREBASE_CONFIG`/`GOOGLE_APPLICATION_CREDENTIALS` env vars automatically.
 * Other modules MUST import `app` / `db` from here (T-8): re-running
 * `initializeApp()` from a subdirectory creates a duplicate app instance
 * that ignores any future config changes attached to the primary.
 */
const app = initializeApp();
const db = getFirestore(app);

export { app, db };
