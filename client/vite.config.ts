import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";

const server = process.env.TERRAKIN_SERVER ?? "http://localhost:8787";

/**
 * A Content-Security-Policy for the production build, as a meta tag at the top of index.html.
 * Dev skips it, because Vite's hot reload injects inline scripts and talks to its own socket.
 *
 * Scripts: our own files, the inline scripts in index.html (by hash, computed here so an edit
 * can't silently break them), and gtag.js. Connections: our own origin (REST and the WebSocket),
 * Google Analytics, and Sentry's ingest host. data: and blob: let the 3D viewer read the parts a
 * model carries inside itself; it refuses anything else on its own (see model-viewer.ts).
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "terrakin-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          (m) =>
            `'sha256-${createHash("sha256")
              .update(m[1] ?? "")
              .digest("base64")}'`,
        );
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(" ")} https://www.googletagmanager.com`,
          "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://*.ingest.us.sentry.io data: blob:",
          "img-src 'self' data: blob: https://*.google-analytics.com https://www.googletagmanager.com",
          "media-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self' data:",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; ");
        // Right after the charset, so it covers every script that follows.
        const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
        if (!/<meta charset[^>]*>/i.test(html)) throw new Error("index.html needs a charset meta");
        return html.replace(/<meta charset[^>]*>/i, (m) => `${m}\n    ${meta}`);
      },
    },
  };
}

export default defineConfig({
  plugins: [contentSecurityPolicy()],
  build: {
    // three.js lives in its own chunk (model-viewer), loaded only when someone opens a 3D model.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: server, ws: true },
      "/media": { target: server },
    },
  },
});
