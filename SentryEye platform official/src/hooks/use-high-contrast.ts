// Shared high-contrast overlay switch.
//
// The preference is device-local and read after mount so SSR markup stays
// stable; the custom event keeps every mounted overlay in sync when the toggle
// is flipped on one page.

import { useCallback, useEffect, useState } from "react";

import {
  HIGH_CONTRAST_EVENT,
  readHighContrastOverlay,
  writeHighContrastOverlay,
} from "@/features/session/live-preferences";

export function useHighContrastOverlay(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(readHighContrastOverlay());
    const handler = (e: Event) => setOn(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(HIGH_CONTRAST_EVENT, handler);
    return () => window.removeEventListener(HIGH_CONTRAST_EVENT, handler);
  }, []);

  const set = useCallback((v: boolean) => {
    setOn(v);
    writeHighContrastOverlay(v);
  }, []);

  return [on, set];
}
