// Per-device live-session preferences.
//
// These are deliberately device-local (not account-synced): a phone and a
// desktop want different camera orientation and different auto-start
// behaviour, and the user should not have to re-choose on every visit.

export type OrientationPreference = "auto" | "portrait" | "landscape";

const ORIENTATION_KEY = "sentryeye.camera-orientation";
const AUTOSTART_KEY = "sentryeye.autostart";
const AUTOSWITCH_KEY = "sentryeye.auto-model-switch";
export const AUTOSWITCH_EVENT = "sentryeye:auto-model-switch-change";

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

export function readOrientationPreference(): OrientationPreference {
  const v = read(ORIENTATION_KEY);
  return v === "portrait" || v === "landscape" || v === "auto" ? v : "auto";
}

export function writeOrientationPreference(pref: OrientationPreference): void {
  write(ORIENTATION_KEY, pref);
}

/**
 * Auto-start live detection when the selected model is already on the device.
 * On by default: a returning driver taps "Live detection" and the camera comes
 * up without a second tap. Turning it off restores the manual Start button.
 */
export function readAutoStartPreference(): boolean {
  return read(AUTOSTART_KEY) !== "off";
}

export function writeAutoStartPreference(enabled: boolean): void {
  write(AUTOSTART_KEY, enabled ? "on" : "off");
}

/**
 * May the app change the model on its own (mobile step-down, quality-based
 * downgrade)? The moment a driver picks a model by hand this turns off, so the
 * phone keeps running the model that was actually chosen.
 */
export function readAutoSwitchPreference(): boolean {
  return read(AUTOSWITCH_KEY) !== "off";
}

export function writeAutoSwitchPreference(enabled: boolean): void {
  write(AUTOSWITCH_KEY, enabled ? "on" : "off");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTOSWITCH_EVENT, { detail: enabled }));
  }
}

const HIGH_CONTRAST_KEY = "sentryeye.high-contrast-overlay";
export const HIGH_CONTRAST_EVENT = "sentryeye:high-contrast-change";

/**
 * High-contrast bounding boxes: thicker strokes, black halo, maximum-luminance
 * palette. Off by default — it is a legibility aid, not the house style.
 */
export function readHighContrastOverlay(): boolean {
  return read(HIGH_CONTRAST_KEY) === "on";
}

export function writeHighContrastOverlay(enabled: boolean): void {
  write(HIGH_CONTRAST_KEY, enabled ? "on" : "off");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(HIGH_CONTRAST_EVENT, { detail: enabled }));
  }
}
