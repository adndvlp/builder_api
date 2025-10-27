Builder_api is a Firebase project using serverless functions to authenticate users, receive experiment data, and send it to the user's own storage provider. Part of the expbuilder ecosystem: https://github.com/adndvlp/expbuilder

## Getting Started

**Note:** This backend is configured to work exclusively with expbuilder (https://github.com/adndvlp/expbuilder) and is not intended for standalone use.

1. **Clone the repository:**

   ```bash
   git clone https://github.com/adndvlp/builder_api.git
   cd builder_api/builder_api
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure Firebase:**

   - Create a Firebase project at https://console.firebase.google.com/
   - Download your service account key and place it in the project directory (e.g., `serviceAccountKey.json`).
   - Create an environment file (e.g., `.env`) with your required variables (Firebase credentials, API keys, etc.).

4. **Deploy or run locally:**
   - For local development, use the Firebase emulator:
     ```bash
     firebase emulators:start --only functions
     ```
   - For deployment, use:
     ```bash
     firebase deploy --only functions
     ```

---

# Copyright

This project is based on DataPipe by Josh de Leeuw.

https://pipe.jspsych.org

de Leeuw, J. R. (2024). DataPipe: Born-open data collection for online experiments. _Behavior Research Methods, 56_(3), 2499-2506.
