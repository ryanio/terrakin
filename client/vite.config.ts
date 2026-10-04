import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homeJsonLd, PAGES, type SitePage } from "@terrakin/protocol";
import { defineConfig, type Plugin } from "vite";
import { markdownTwin, staticPage } from "./src/site-page";

const server = process.env.TERRAKIN_SERVER ?? "http://localhost:8787";
const repo = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

/**
 * A Content-Security-Policy for the production build, as a meta tag at the top of every page
 * (index.html and docs.html).
 * Dev skips it, because Vite's hot reload injects inline scripts and talks to its own socket.
 *
 * Scripts: our own files, the inline scripts in each page (by hash, computed here so an edit
 * can't silently break them), and gtag.js. JSON-LD blocks don't run, so CSP ignores them and they
 * need no hash. Connections: our own origin (REST and the WebSocket), Google Analytics, and
 * Sentry's ingest host. data: and blob: let the 3D viewer read the parts a model carries inside
 * itself; it refuses anything else on its own (see model-viewer.ts).
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "terrakin-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const hashes = [
          ...html.matchAll(
            /<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g,
          ),
        ].map(
          (m) =>
            `'sha256-${createHash("sha256")
              .update(m[1] ?? "")
              .digest("base64")}'`,
        );
        const policy = [
          "default-src 'self'",
          ["script-src 'self'", ...hashes, "https://www.googletagmanager.com"].join(" "),
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
        return withCsp(html, policy);
      },
    },
  };
}

/** The static pages run no scripts at all. */
const STATIC_PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

/** Put a CSP meta right after the charset, so it covers everything that follows. */
function withCsp(html: string, policy: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  if (!/<meta charset[^>]*>/i.test(html)) throw new Error("The page needs a charset meta");
  return html.replace(/<meta charset[^>]*>/i, (m) => `${m}\n    ${meta}`);
}

/**
 * The site pages from docs/site/*.md and protocol/src/site.ts (the one source for each):
 *
 * - the homepage's JSON-LD (WebSite, Organization, WebApplication, FAQPage) in index.html,
 * - a Markdown twin for every page with `prose` (`/index.md`, `/about.md`, `/pricing.md`, ...),
 *   with frontmatter for title, description, canonical, and last-updated,
 * - static HTML for the `static` pages (`/about.html`, served at `/about`), with no scripts.
 *
 * Dates come from docs/site/lastmod.json, which `pnpm gen` keeps.
 */
function sitePages(): Plugin {
  const prose = (PAGES as readonly SitePage[]).filter((p) => p.prose);
  const lastmod = () =>
    JSON.parse(readFileSync(repo("docs/site/lastmod.json"), "utf8")) as Record<
      string,
      { lastmod: string }
    >;
  const read = (page: SitePage) => readFileSync(repo(`docs/site/${page.prose}.md`), "utf8");
  const dated = (page: SitePage) => lastmod()[page.path]?.lastmod ?? "";
  const twinFile = (page: SitePage) => (page.markdown ?? page.path).slice(1);
  const htmlFile = (page: SitePage) => `${page.path.slice(1)}.html`;

  return {
    name: "terrakin-site",
    transformIndexHtml(html, ctx) {
      // The homepage's description; the docs page (docs.html) has its own.
      if (ctx.path !== "/index.html") return html;
      const json = JSON.stringify(homeJsonLd()).replace(/</g, "\\u003c");
      const script = `<script type="application/ld+json">${json}</script>`;
      return html.replace("</head>", `    ${script}\n  </head>`);
    },
    configureServer(dev) {
      // `pnpm dev` serves the same pages, styled with the dev stylesheet.
      dev.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        for (const page of prose) {
          if (path === `/${twinFile(page)}`) {
            res.setHeader("content-type", "text/markdown; charset=utf-8");
            return res.end(markdownTwin(page, read(page), dated(page)));
          }
          if (page.kind === "static" && path === page.path) {
            res.setHeader("content-type", "text/html; charset=utf-8");
            const css = "/src/style.css";
            return res.end(staticPage({ page, source: read(page), lastUpdated: dated(page), css }));
          }
        }
        next();
      });
    },
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (c) => c.type === "chunk" && c.isEntry && c.facadeModuleId?.endsWith("/index.html"),
      );
      // Only the app build: the docs build reuses this config for docs.html alone.
      if (!entry) return;
      const css =
        entry?.type === "chunk" ? [...(entry.viteMetadata?.importedCss ?? [])][0] : undefined;
      if (!css) throw new Error("terrakin-site: no stylesheet for the static pages");
      for (const page of prose) {
        const source = read(page);
        const lastUpdated = dated(page);
        if (!lastUpdated) throw new Error(`No lastmod for ${page.path}; run pnpm gen`);
        this.emitFile({
          type: "asset",
          fileName: twinFile(page),
          source: markdownTwin(page, source, lastUpdated),
        });
        if (page.kind !== "static") continue;
        const html = staticPage({ page, source, lastUpdated, css: `/${css}` });
        this.emitFile({
          type: "asset",
          fileName: htmlFile(page),
          source: withCsp(html, STATIC_PAGE_POLICY),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [sitePages(), contentSecurityPolicy()],
  build: {
    // three.js lives in its own chunk (model-viewer), loaded only when someone opens a 3D model.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: server, ws: true },
      "/media": { target: server },
      // Pages built from live data: Markdown twins of profiles and posts, and the sitemaps.
      "^/(r|p)/[^/]+\\.md$": { target: server },
      "^/sitemap(-(residents|posts)(-\\d+)?)?\\.xml$": { target: server },
    },
  },
});
