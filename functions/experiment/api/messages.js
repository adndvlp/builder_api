const MESSAGES = {
  MISSING_PARAMETER: {
    error: "MISSING_PARAMETER",
    message: "One or more required parameters are missing.",
  },
  DATA_COLLECTION_NOT_ACTIVE: {
    error: "DATA_COLLECTION_NOT_ACTIVE",
    message: "Data collection is not active for this experiment",
  },
  EXPERIMENT_NOT_FOUND: {
    error: "EXPERIMENT_NOT_FOUND",
    message: "The experiment ID does not match an experiment",
  },
  INVALID_OWNER: {
    error: "INVALID_OWNER",
    message: "The owner ID of this experiment does not match a valid user",
  },
  INVALID_OSF_TOKEN: {
    error: "INVALID_OSF_TOKEN",
    message: "The OSF token for this experiment is not valid",
  },
  INVALID_DROPBOX_TOKEN: {
    error: "INVALID_DROPBOX_TOKEN",
    message: "The Dropbox token for this experiment is not valid",
  },
  INVALID_GOOGLE_DRIVE_TOKEN: {
    error: "INVALID_GOOGLE_DRIVE_TOKEN",
    message: "The Google Drive token for this experiment is not valid",
  },
  INVALID_DATA: {
    error: "INVALID_DATA",
    message:
      "The data are not valid according to the validation parameters set for this experiment.",
  },
  SESSION_LIMIT_REACHED: {
    error: "SESSION_LIMIT_REACHED",
    message: "The session limit for this experiment has been reached",
  },
  DROPBOX_FILE_EXISTS: {
    error: "DROPBOX_FILE_EXISTS",
    message: "The Dropbox file already exists. File names must be unique.",
  },
  DROPBOX_UPLOAD_ERROR: {
    error: "DROPBOX_UPLOAD_ERROR",
    message: "An error occurred while uploading the data to Dropbox",
  },
  GOOGLE_DRIVE_FILE_EXISTS: {
    error: "GOOGLE_DRIVE_FILE_EXISTS",
    message: "The Google Drive file already exists. File names must be unique.",
  },
  GOOGLE_DRIVE_UPLOAD_ERROR: {
    error: "GOOGLE_DRIVE_UPLOAD_ERROR",
    message: "An error occurred while uploading the data to Google Drive",
  },
  FILE_ALREADY_EXISTS: {
    error: "FILE_ALREADY_EXISTS",
    message: "The file already exists. File names must be unique.",
  },
  MAX_SESSIONS_REACHED: {
    error: "MAX_SESSIONS_REACHED",
    message:
      "The maximum number of sessions for this experiment has been reached",
  },
  CONDITION_ASSIGNMENT_NOT_ACTIVE: {
    error: "CONDITION_ASSIGNMENT_NOT_ACTIVE",
    message: "Condition assignment is not active for this experiment",
  },
  UNKNOWN_ERROR_GETTING_CONDITION: {
    error: "UNKNOWN_ERROR_GETTING_CONDITION",
    message:
      "An unknown error occurred while getting the condition for this experiment",
  },
  SUCCESS: {
    message: "Success",
  },
};

export default MESSAGES;
