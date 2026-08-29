// Last-good engine memory.
//
// Re-probing WebGPU on every visit costs a phone several seconds — and on the
// Android drivers that hang inside requestAdapter() it costs the whole boot.
// Once a device has actually produced a working session we remember which
// engine it was, and the next visit starts straight on it. A failed attempt
// clears the memory so a device can never get stuck on a broken engine.

import { readEnginePreference, type EnginePreference } from "./engine-preference";

const KEY = "sentryeye.last-good-engine";

export type KnownEngine = "webgpu" | "wasm";

function normalize(value: string | null): KnownEngine | null {
  if (value === "webgpu" || value === "wasm") return value;
  // ORT reports "webgl" on a few builds; treat anything GPU-ish as GPU.
  if (value === "webgl") return "webgpu";
  return null;
}

export function readLastGoodEngine(): KnownEngine | null {
  if (typeof window === "undefined") return null;
  try {
    return normalize(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function writeLastGoodEngine(engine: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const value = normalize(engine ?? null);
  if (!value) return;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* storage blocked */
  }
}

export function clearLastGoodEngine(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

/**
 * Preference actually handed to the worker. An explicit user choice always
 * wins; otherwise a remembered CPU-only device skips the GPU probe entirely.
 */
export function effectiveEnginePreference(): EnginePreference {
  const pref = readEnginePreference();
  if (pref !== "auto") return pref;
  return readLastGoodEngine() === "wasm" ? "wasm" : "auto";
}
