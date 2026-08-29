// Shared, typed enum of allowed session `source` values. This MUST stay in
// sync with the sessions_source_check constraint in the database.
export const SESSION_SOURCES = ["webcam", "video-upload", "image-upload"] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];
