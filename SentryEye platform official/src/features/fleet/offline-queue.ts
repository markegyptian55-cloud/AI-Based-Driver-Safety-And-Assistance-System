// Offline-first shift store.
//
// The AI runs entirely on-device, so a shift must be startable, recordable and
// finalisable with no network at all. Every shift is written to IndexedDB first
// and carries a stable `clientShiftId`; synchronisation is an idempotent upsert
// on that id, so retrying an interrupted upload can never produce two reports.

import type { LocalShift, SafetyEventInput, SyncState } from "./types";

const DB_NAME = "sentryeye-fleet";
const STORE = "shifts";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no-indexeddb"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "clientShiftId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexeddb-open-failed"));
    });
  }
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb-request-failed"));
  });
}

export async function putShift(shift: LocalShift): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(shift) as IDBRequest<IDBValidKey>);
  } catch {
    /* storage unavailable (private mode) — the in-memory session still works */
  }
}

export async function getShift(clientShiftId: string): Promise<LocalShift | null> {
  try {
    const row = await tx<LocalShift | undefined>(
      "readonly",
      (s) => s.get(clientShiftId) as IDBRequest<LocalShift | undefined>,
    );
    return row ?? null;
  } catch {
    return null;
  }
}

export async function allShifts(): Promise<LocalShift[]> {
  try {
    const rows = await tx<LocalShift[]>(
      "readonly",
      (s) => s.getAll() as IDBRequest<LocalShift[]>,
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

export async function deleteShift(clientShiftId: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(clientShiftId) as IDBRequest<undefined>);
  } catch {
    /* ignore */
  }
}

export async function pendingShifts(): Promise<LocalShift[]> {
  const rows = await allShifts();
  return rows.filter((r) => r.sync !== "synced");
}

export async function activeLocalShift(): Promise<LocalShift | null> {
  const rows = await allShifts();
  return rows.find((r) => r.status === "active") ?? null;
}

export async function appendEvents(
  clientShiftId: string,
  events: SafetyEventInput[],
): Promise<void> {
  if (!events.length) return;
  const shift = await getShift(clientShiftId);
  if (!shift) return;
  const seen = new Set(shift.events.map((e) => e.clientEventId));
  const merged = shift.events.concat(events.filter((e) => !seen.has(e.clientEventId)));
  await putShift({ ...shift, events: merged });
}

export async function setSync(clientShiftId: string, sync: SyncState): Promise<void> {
  const shift = await getShift(clientShiftId);
  if (shift) await putShift({ ...shift, sync });
}

/** Prune synced shifts older than a week so the local store stays small. */
export async function prune(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const rows = await allShifts();
  const cutoff = Date.now() - maxAgeMs;
  await Promise.all(
    rows
      .filter((r) => r.sync === "synced" && new Date(r.startedAt).getTime() < cutoff)
      .map((r) => deleteShift(r.clientShiftId)),
  );
}
