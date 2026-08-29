// In-memory SessionPort used by visitors (no account). Detection, scoring and
// live stats work exactly the same; nothing is written to the database.

import type { SessionPort } from "./session-recorder";

export function createGuestSessionPort(): SessionPort {
  return {
    async createSession() {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `guest-${Date.now()}`;
      return { id };
    },
    async insertEvents() {
      /* visitors keep events in memory only */
    },
    async updateSession() {
      /* no-op */
    },
    async endSession() {
      /* no-op */
    },
  };
}
