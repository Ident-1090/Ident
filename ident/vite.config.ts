/// <reference types="vitest" />

import { execSync } from "node:child_process";
import { relative, sep } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";

// Build version, read at build time: the release tag when built from a tagged
// commit (the released container), otherwise the short commit hash so ad-hoc /
// staging builds are still identifiable. Empty only when git is unavailable.
const appVersion = (() => {
  const git = (args: string): string => {
    try {
      return execSync(`git ${args}`, {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      return "";
    }
  };
  return git("describe --tags --exact-match") || git("rev-parse --short HEAD");
})();

// Demo build only: bake the public showcase's share-card metadata with an
// absolute og:image (the demo's GitHub Pages URL is known at build time) and
// opt into search indexing. Real receiver-local deployments are served by
// identd, which injects their card metadata at request time with an absolute
// URL derived from the request host — og:image must be absolute, and the
// deployment host isn't known at build time. Non-demo builds get nothing here.
function ogMetaPlugin(): Plugin {
  const DEMO_SITE = "https://ident-1090.github.io/Ident/";
  const IMG = `${DEMO_SITE}og.png`;
  const TITLE = "Ident — live ADS-B from your receiver";
  const DESC =
    "Live traffic from your own ADS-B receiver, in a fast modern interface for desktop, tablet, and phone.";
  return {
    name: "ident-og-meta",
    transformIndexHtml(html) {
      if (process.env.VITE_IDENT_DEMO !== "true") return html;
      const tags = [
        `<meta name="description" content="${DESC}" />`,
        `<link rel="canonical" href="${DEMO_SITE}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="Ident" />`,
        `<meta property="og:title" content="${TITLE}" />`,
        `<meta property="og:description" content="${DESC}" />`,
        `<meta property="og:url" content="${DEMO_SITE}" />`,
        `<meta property="og:image" content="${IMG}" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${TITLE}" />`,
        `<meta name="twitter:description" content="${DESC}" />`,
        `<meta name="twitter:image" content="${IMG}" />`,
      ].join("\n    ");
      return html
        .replace(
          /<meta name="robots"[^>]*>/,
          `<meta name="robots" content="index, follow" />`,
        )
        .replace(/\s*<meta name="googlebot"[^>]*>/, "")
        .replace("</head>", `    ${tags}\n  </head>`);
    },
  };
}

function ignoreDevWatchPath(
  filePath: string,
  stats?: { isDirectory: () => boolean },
): boolean {
  if (stats?.isDirectory()) return false;
  if (filePath.endsWith(".md")) return true;
  const rel = relative(process.cwd(), filePath);
  if (rel === "") return false;
  if (/(^|[\\/]).+\.test\.[cm]?[jt]sx?$/.test(rel)) return true;
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
    base: "./",
    define: {
      __IDENT_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [react(), tailwindcss(), ogMetaPlugin()],
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
        "/api/ws": wsProxy,
        "/api/chunks": httpProxy,
        "/api/trails": httpProxy,
        "/api/replay": httpProxy,
        "/api/update.json": httpProxy,
      },
    },
    preview: {
      port: 5174,
      proxy: {
        "/api/ws": wsProxy,
        "/api/chunks": httpProxy,
        "/api/trails": httpProxy,
        "/api/replay": httpProxy,
        "/api/update.json": httpProxy,
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: [],
    },
  };
});
