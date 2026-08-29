// Persistent model-weight cache.
//
// The ONNX file is 10-30 MB. Keeping it only in the warm provider means every
// reload, and every switch away and back, pays the download again — so "the
// model loads once" was never actually true. This stores the raw bytes in
// IndexedDB keyed by the immutable asset URL, so a second visit is a disk read.
//
// Worker-safe: no DOM, no React.

const DB_NAME = "sentryeye-models";
const STORE = "weights";
/** Partially downloaded files, so a dropped connection resumes instead of restarting. */
const PARTIAL_STORE = "partials";
const VERSION = 2;

export interface CachedModel {
  key: string;
  modelId: string;
  url: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

export function modelCacheKey(modelId: string, url: string): string {
  return `${modelId}::${url}`;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "key" });
        }
        if (!req.result.objectStoreNames.contains(PARTIAL_STORE)) {
          req.result.createObjectStore(PARTIAL_STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readCachedModel(key: string): Promise<Uint8Array | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const row = req.result as CachedModel | undefined;
        resolve(row?.bytes ? new Uint8Array(row.bytes) : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Store the bytes and evict any other entry for the same model id. */
export async function writeCachedModel(
  key: string,
  modelId: string,
  url: string,
  bytes: Uint8Array,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const copy = bytes.slice().buffer;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      // Stale versions of the same model (different asset URL) are dead weight.
      const all = store.getAllKeys();
      all.onsuccess = () => {
        for (const k of all.result as string[]) {
          if (k !== key && k.startsWith(`${modelId}::`)) store.delete(k);
        }
        store.put({ key, modelId, url, bytes: copy, savedAt: Date.now() } satisfies CachedModel);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Keys currently held in the on-device weight cache. */
export async function listCachedKeys(): Promise<string[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** True when this exact model build is already saved for offline use. */
export async function hasCachedModel(modelId: string, url: string): Promise<boolean> {
  const keys = await listCachedKeys();
  return keys.includes(modelCacheKey(modelId, url));
}

/** Drop every cached build of one model. */
export async function deleteCachedModel(modelId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const keys = await listCachedKeys();
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const k of keys) if (k.startsWith(`${modelId}::`)) store.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

interface PartialDownload {
  key: string;
  url: string;
  bytes: ArrayBuffer;
  total: number | null;
  savedAt: number;
}

async function readPartial(key: string): Promise<PartialDownload | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(PARTIAL_STORE, "readonly").objectStore(PARTIAL_STORE).get(key);
      req.onsuccess = () => resolve((req.result as PartialDownload | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writePartial(
  key: string,
  url: string,
  bytes: Uint8Array,
  total: number | null,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const copy = bytes.slice().buffer;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PARTIAL_STORE, "readwrite");
      tx.objectStore(PARTIAL_STORE).put({
        key,
        url,
        bytes: copy,
        total,
        savedAt: Date.now(),
      } satisfies PartialDownload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearPartial(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PARTIAL_STORE, "readwrite");
      tx.objectStore(PARTIAL_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Bytes already downloaded for a model that has not finished yet. */
export async function partialDownloadBytes(modelId: string, url: string): Promise<number> {
  const row = await readPartial(modelCacheKey(modelId, url));
  return row?.bytes.byteLength ?? 0;
}

/** Throw away a half-finished download so the next attempt starts clean. */
export async function discardPartialDownload(modelId: string, url: string): Promise<void> {
  await clearPartial(modelCacheKey(modelId, url));
}

function concat(parts: Uint8Array[], length: number): Uint8Array {
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const c of parts) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

/** How long a stream may deliver no bytes at all before we treat it as dead. */
const STALL_TIMEOUT_MS = 15_000;
/** Attempts per download; each retry resumes from the bytes already held. */
const MAX_ATTEMPTS = 3;
/** Parallel range segments. Four streams saturate a mobile link without thrash. */
const SEGMENTS = 4;
/** Below this a single stream is already optimal — splitting only adds RTTs. */
const PARALLEL_MIN_BYTES = 4_000_000;
/** Progress is UI-only: 8 Hz is smooth and costs no re-render storm. */
const PROGRESS_INTERVAL_MS = 125;

type Progress = (received: number, total: number | null) => void;

/** Wraps a callback so a 10 MB download cannot fire thousands of React updates. */
function throttleProgress(fn?: Progress): Progress {
  if (!fn) return () => {};
  let last = 0;
  return (received, total) => {
    const now = Date.now();
    if (now - last < PROGRESS_INTERVAL_MS) return;
    last = now;
    fn(received, total);
  };
}

/** Reject if the stream delivers nothing for STALL_TIMEOUT_MS. */
async function readWithTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Download stalled")), STALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Ask for one byte: tells us the file size and whether ranges are supported. */
async function probeRange(
  url: string,
  signal?: AbortSignal,
): Promise<{ ranged: boolean; total: number | null }> {
  try {
    const res = await fetch(url, { signal, headers: { Range: "bytes=0-0" } });
    if (res.status !== 206) {
      res.body?.cancel().catch(() => {});
      return { ranged: false, total: Number(res.headers.get("content-length")) || null };
    }
    await res.arrayBuffer();
    const cr = res.headers.get("content-range");
    const total = cr ? Number(cr.split("/")[1]) : NaN;
    return { ranged: true, total: Number.isFinite(total) && total > 0 ? total : null };
  } catch {
    return { ranged: false, total: null };
  }
}

/** Download one byte range into memory, reporting bytes as they land. */
async function fetchSegment(
  url: string,
  start: number,
  end: number,
  onBytes: (n: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetch(url, { signal, headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`Range request failed (${res.status})`);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes(buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await readWithTimeout(reader);
    if (done) break;
    if (!value) continue;
    parts.push(value);
    size += value.byteLength;
    onBytes(value.byteLength);
  }
  return concat(parts, size);
}

/**
 * Fetch a model's weights and persist them, reporting progress.
 *
 * Fast path: when the server supports byte ranges the file is pulled in four
 * parallel segments, which is where the wall-clock win on mobile comes from.
 * Slow path (and every resume): a single stream that appends to whatever is
 * already stored, with a stall watchdog so a dead connection retries instead
 * of leaving the UI on "downloading" forever.
 */
export async function downloadModelToCache(
  modelId: string,
  url: string,
  onProgress?: (received: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<void> {
  const key = modelCacheKey(modelId, url);
  if (await hasCachedModel(modelId, url)) return;
  const report = throttleProgress(onProgress);

  const resumeFrom = await readPartial(key);
  const probe = await probeRange(url, signal);

  // Nothing on disk yet and the server honours ranges: go wide.
  if (!resumeFrom && probe.ranged && probe.total && probe.total >= PARALLEL_MIN_BYTES) {
    try {
      const total = probe.total;
      const span = Math.ceil(total / SEGMENTS);
      let received = 0;
      const bump = (n: number) => {
        received += n;
        report(received, total);
      };
      const segments = await Promise.all(
        Array.from({ length: SEGMENTS }, (_, i) => {
          const start = i * span;
          const end = Math.min(total - 1, start + span - 1);
          return start > end
            ? Promise.resolve(new Uint8Array(0))
            : fetchSegment(url, start, end, bump, signal);
        }),
      );
      const merged = concat(segments, segments.reduce((s, p) => s + p.byteLength, 0));
      if (merged.byteLength === total) {
        onProgress?.(total, total);
        await writeCachedModel(key, modelId, url, merged);
        await clearPartial(key);
        return;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      // Any segment problem: fall through to the resilient single stream.
    }
  }

  await sequentialDownload(key, modelId, url, report, onProgress, probe.total, signal);
}

async function sequentialDownload(
  key: string,
  modelId: string,
  url: string,
  report: Progress,
  onProgress: Progress | undefined,
  knownTotal: number | null,
  signal?: AbortSignal,
): Promise<void> {
  let lastError: unknown = new Error("Download failed");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const resumeFrom = await readPartial(key);
    let received = resumeFrom?.bytes.byteLength ?? 0;
    const chunks: Uint8Array[] = resumeFrom ? [new Uint8Array(resumeFrom.bytes)] : [];
    onProgress?.(received, resumeFrom?.total ?? knownTotal);

    try {
      const res = await fetch(url, {
        signal,
        headers: received > 0 ? { Range: `bytes=${received}-` } : undefined,
      });
      if (!res.ok && res.status !== 206) throw new Error(`Download failed (${res.status})`);

      // 200 means the server ignored the range: start over from an empty buffer.
      if (res.status !== 206 && received > 0) {
        chunks.length = 0;
        received = 0;
      }
      const remaining = Number(res.headers.get("content-length")) || null;
      const total =
        remaining != null ? received + remaining : (resumeFrom?.total ?? knownTotal);

      if (!res.body) {
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf);
        received += buf.byteLength;
        onProgress?.(received, total);
        await writeCachedModel(key, modelId, url, concat(chunks, received));
        await clearPartial(key);
        return;
      }

      const reader = res.body.getReader();
      let sinceCheckpoint = 0;
      for (;;) {
        const { done, value } = await readWithTimeout(reader);
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        received += value.byteLength;
        sinceCheckpoint += value.byteLength;
        report(received, total);
        // Checkpoint every ~4 MB so a drop costs at most that much progress
        // without paying a full-buffer copy every couple of megabytes.
        if (sinceCheckpoint >= 4_000_000) {
          sinceCheckpoint = 0;
          await writePartial(key, url, concat(chunks, received), total);
        }
      }

      onProgress?.(received, total);
      await writeCachedModel(key, modelId, url, concat(chunks, received));
      await clearPartial(key);
      return;
    } catch (err) {
      lastError = err;
      // Keep what arrived so the retry (or the user's Resume) starts from here.
      if (received > 0) {
        await writePartial(key, url, concat(chunks, received), knownTotal);
      }
      if (signal?.aborted) throw err;
      // Backoff before reconnecting: 0.5s, then 1.5s.
      await new Promise((r) => setTimeout(r, 500 + attempt * 1000));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}



export interface CachedModelStat {
  key: string;
  modelId: string;
  url: string;
  bytes: number;
  savedAt: number;
}

/** Everything currently occupying the on-device weight cache, with sizes. */
export async function cachedModelStats(): Promise<CachedModelStat[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result as CachedModel[]) ?? [];
        resolve(
          rows.map((r) => ({
            key: r.key,
            modelId: r.modelId,
            url: r.url,
            bytes: r.bytes.byteLength,
            savedAt: r.savedAt,
          })),
        );
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Delete exactly one stored file, addressed by its cache key. */
export async function deleteCachedKey(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export interface PartialDownloadStat {
  key: string;
  modelId: string;
  url: string;
  bytes: number;
  total: number | null;
  savedAt: number;
}

/** Half-finished downloads still occupying space, so the UI can offer cleanup. */
export async function partialDownloadStats(): Promise<PartialDownloadStat[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(PARTIAL_STORE, "readonly").objectStore(PARTIAL_STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result as PartialDownload[]) ?? [];
        resolve(
          rows.map((r) => ({
            key: r.key,
            modelId: r.key.split("::")[0] ?? r.key,
            url: r.url,
            bytes: r.bytes.byteLength,
            total: r.total,
            savedAt: r.savedAt,
          })),
        );
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Drop one half-finished download by its cache key. */
export async function deletePartialKey(key: string): Promise<void> {
  await clearPartial(key);
}

/**
 * Stored files that no live model build points at any more — old exports left
 * behind by a model update. `liveKeys` is every key the registry still uses.
 */
export function orphanedStats(
  stats: CachedModelStat[],
  liveKeys: ReadonlySet<string>,
): CachedModelStat[] {
  return stats.filter((s) => !liveKeys.has(s.key));
}
