/**
 * Single source of truth for the application version shown in the UI.
 * Phase numbering follows the delivered product milestones.
 */
export const APP_NAME = "SentryEye";
export const APP_VERSION = "1.0.0";
export const APP_CHANNEL = import.meta.env.DEV ? "development" : "production";
