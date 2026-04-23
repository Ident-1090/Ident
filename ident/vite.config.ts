/// <reference types="vitest" />

import { relative, sep } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function ignoreDevWatchPath(
  filePath: string,
  stats?: { isDirectory: () => boolean },
): boolean {
  if (stats?.isDirectory()) return false;
  if (filePath.endsWith(".md")) return true;
  const rel = relative(process.cwd(), filePath);
  if (rel === "") return false;
  return rel !== "src" && !rel.startsWith(`src${sep}`);
}

function manualVendorChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;

  const normalized = id.split(sep).join("/");
  if (
    normalized.includes("/react/") ||
    normalized.includes("/react-dom/") ||
    normalized.includes("/scheduler/")
  ) {
    return "vendor-react";
  }

  if (
    normalized.includes("/maplibre-gl/") ||
    normalized.includes("/@mapbox/") ||
    normalized.includes("/@maplibre/") ||
    normalized.includes("/earcut/") ||
    normalized.includes("/geojson-vt/") ||
    normalized.includes("/kdbush/") ||
    normalized.includes("/potpack/") ||
    normalized.includes("/quickselect/") ||
    normalized.includes("/supercluster/") ||
    normalized.includes("/tinyqueue/")
  ) {
    return "vendor-map";
  }

  return "vendor";
}

// Dev-proxy config is read from Vite env vars so .env.local can point at a
// receiver without committing the URL. Defaults target a local identd process.
//
// Override in ident/.env.local (gitignored):
//   VITE_DEV_PROXY_TARGET=https://receiver.example.test
//   VITE_DEV_PROXY_WS=wss://receiver.example.test
//   VITE_DEV_PROXY_INSECURE=1           # skip TLS verify for local test certs
//   VITE_DEV_PROXY_LOG=1                # log proxied requests + upstream errors
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_DEV_PROXY_TARGET || "http://localhost:8080";
  const wsTarget = env.VITE_DEV_PROXY_WS || "ws://localhost:8080";
  const insecure = env.VITE_DEV_PROXY_INSECURE === "1";
  const logProxy = env.VITE_DEV_PROXY_LOG === "1" || insecure;

  function configure(proxy: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
  }) {
    if (!logProxy) return;
    proxy.on("error", (...args: unknown[]) => {
      const err = args[0] as NodeJS.ErrnoException;
      const req = args[1] as { method?: string; url?: string };
      // eslint-disable-next-line no-console
      console.error(
        `[proxy error] ${req?.method} ${req?.url} → ${err.code ?? ""} ${err.message}`,
      );
    });
    proxy.on("proxyReq", (...args: unknown[]) => {
      const req = args[1] as { method?: string; url?: string };
      // eslint-disable-next-line no-console
      console.log(`[proxy →] ${req?.method} ${req?.url}`);
    });
    proxy.on("proxyRes", (...args: unknown[]) => {
      const proxyRes = args[0] as { statusCode?: number };
      const req = args[1] as { method?: string; url?: string };
      // eslint-disable-next-line no-console
      console.log(
        `[proxy ←] ${proxyRes?.statusCode} ${req?.method} ${req?.url}`,
      );
    });
  }

  const httpProxy: ProxyOptions = {
    target,
    changeOrigin: true,
    secure: !insecure,
    configure,
  };
  const wsProxy: ProxyOptions = {
    target: wsTarget,
    ws: true,
    changeOrigin: true,
    secure: !insecure,
    configure,
  };

  return {
    base: "/",
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        includeAssets: [
          "icons/icon.svg",
          "icons/favicon.ico",
          "icons/apple-touch-icon-180x180.png",
        ],
        manifest: {
          name: "Ident",
          short_name: "Ident",
          description: "Modern ADS-B traffic display for a local receiver",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "any",
          background_color: "#0f1113",
          theme_color: "#0f1113",
          icons: [
            { src: "icons/pwa-64x64.png", sizes: "64x64", type: "image/png" },
            {
              src: "icons/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "icons/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "icons/maskable-icon-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "icons/icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any",
            },
          ],
        },
        workbox: {
          sourcemap: false,
          globPatterns: ["**/*.{js,css,html,svg,woff2}"],
          // SPA routing fallback, but the websocket and live-data endpoints
          // must always hit the network — the SW must never pretend a lost
          // ADS-B stream is the index.html shell.
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/(ws|data|chunks)/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/maplibre-gl.*/,
              handler: "CacheFirst",
              options: {
                cacheName: "maplibre-cdn",
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                },
              },
            },
            {
              urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource.*/,
              handler: "CacheFirst",
              options: {
                cacheName: "fontsource",
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 365 * 24 * 60 * 60,
                },
              },
            },
            {
              urlPattern:
                /^https:\/\/(tiles\.openfreemap\.org|server\.arcgisonline\.com)\/.*/,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "basemap-tiles",
                expiration: {
                  maxEntries: 500,
                  maxAgeSeconds: 14 * 24 * 60 * 60,
                },
              },
            },
          ],
        },
      }),
    ],
    build: {
      outDir: "dist",
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: manualVendorChunk,
        },
      },
    },
    server: {
      port: 5173,
      watch: {
        // Keep browser updates tied to source edits; docs and repo-root notes
        // should not trigger HMR/full reload while iterating in dev.
        ignored: ignoreDevWatchPath,
      },
      proxy: {
        "/ws": wsProxy,
        "/data": httpProxy,
        "/chunks": httpProxy,
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: [],
    },
  };
});
