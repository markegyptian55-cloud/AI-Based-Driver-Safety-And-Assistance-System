// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

// Cross-origin isolation is intentionally NOT enabled.
//
// The published build serves /assets/* (including the inference worker script
// and the ORT wasm binaries) straight from the CDN, without a COEP header. A
// COEP document may only spawn a dedicated worker whose script carries a
// matching COEP header, so isolation made every published session fail with
// "Inference worker failed to start: worker crashed". Without isolation there
// is no SharedArrayBuffer, so the WASM runtime falls back to a single thread —
// which browser-worker.ts already handles via `crossOriginIsolated`. WebGPU,
// the fast path, is unaffected. Dev must match production here, otherwise the
// failure only appears after publishing.


export default defineConfig({
  vite: {
    plugins: [
      
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        devOptions: { enabled: false },
        filename: "sw.js",
        // The served client root for this SSR build.
        outDir: "dist/client",
        manifest: {
          name: "SentryEye — Driver Safety",
          short_name: "SentryEye",
          description:
            "On-device AI driver drowsiness detection with offline live and video analysis.",
          start_url: "/live",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: "#04120a",
          theme_color: "#00e05a",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // The app shell + built assets. Detection models stay in IndexedDB
          // and are never duplicated into the service-worker cache.
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          // SSR build: there is no static index.html to fall back to, so
          // navigations are handled by the NetworkFirst rule below.
          navigateFallback: undefined,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // HTML navigations: always try the network first.
              urlPattern: ({ request }: { request: Request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "sentryeye-shell",
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // Inference + video runtime binaries: immutable, cache-first.
              urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
                sameOrigin && (url.pathname.startsWith("/ort/") || url.pathname.startsWith("/wasm/")),
              handler: "CacheFirst",
              options: {
                cacheName: "sentryeye-runtime-binaries",
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 180 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
                sameOrigin && url.pathname.startsWith("/assets/"),
              handler: "CacheFirst",
              options: {
                cacheName: "sentryeye-assets",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
          ],
        },
      }),
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
