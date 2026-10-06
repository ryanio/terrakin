import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const server = process.env.TERRAKIN_SERVER ?? "http://localhost:8787";

/**
 * The staff app. The build goes into the client's dist under `_admin/`, so the Worker's ASSETS
 * binding (and the Node server's static dir) already holds it; the server hands those files out
 * only on an `admin.*` host, with the strict headers in `packages/server/src/pages.ts`
 * (ADMIN_PAGE_HEADERS). Run it after the client build, which empties packages/client/dist.
 *
 * That policy allows no inline script or style and no data: fonts, so nothing is inlined here and
 * the module preload polyfill (an inline helper in some setups) stays off.
 *
 * In dev, open http://admin.localhost:5174. The proxy keeps the Host and Origin headers, so the
 * server sees the admin host and staff routes accept the calls.
 */
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/_admin/" : "/",
  build: {
    outDir: fileURLToPath(new URL("../client/dist/_admin", import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/v1": { target: server },
      "/media": { target: server },
    },
  },
}));
