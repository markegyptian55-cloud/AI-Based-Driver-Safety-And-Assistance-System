// Offline support registration wrapper.
//
// The service worker is only ever registered in a real published browser tab.
// Lovable previews, iframes and dev servers unregister any stale worker so a
// cached shell can never mask fresh code while building.

const SW_URL = "/sw.js";

function isPreviewHost(hostname: string): boolean {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

async function unregisterAppWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      registrations
        .filter((r) => (r.active?.scriptURL ?? r.installing?.scriptURL ?? "").includes(SW_URL))
        .map((r) => r.unregister()),
    );
  } catch {
    /* nothing we can do */
  }
}

/**
 * Registers the offline service worker when it is safe to do so.
 * Returns a cleanup-free promise; callers can ignore the result.
 */
export async function setupOfflineSupport(onUpdate?: () => void): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const refused =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    isPreviewHost(window.location.hostname) ||
    new URLSearchParams(window.location.search).get("sw") === "off";

  if (refused) {
    await unregisterAppWorker();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          onUpdate?.();
        }
      });
    });
  } catch (err) {
    console.warn("[pwa] service worker registration failed", err);
  }
}
