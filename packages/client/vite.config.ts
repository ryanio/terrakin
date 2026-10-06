import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  DEVLOG_POSTS,
  devlogPostMarkdown,
  devlogSitePage,
  homeJsonLd,
  PAGES,
  type SitePage,
} from "@terrakin/protocol";
import { iconSvg, isIconName } from "@terrakin/ui/icons";
import { defineConfig, type Plugin } from "vite";
import { footerHtml, markdownTwin, staticPage } from "./src/site-page";

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
 * The icons in the HTML pages: each `<svg class="..." data-icon="name" aria-hidden="true"></svg>`
 * becomes that Lucide icon from `@terrakin/ui/icons`, the map `icon()` draws from at run time. An
 * unknown name fails the build.
 */
function icons(): Plugin {
  return {
    name: "terrakin-icons",
    transformIndexHtml(html, ctx) {
      const out = html.replace(
        /<svg class="([^"]+)" data-icon="([^"]+)" aria-hidden="true"><\/svg>/g,
        (_, className: string, name: string) => {
          if (!isIconName(name))
            throw new Error(`${ctx.path}: no icon "${name}" in ui/src/icons.ts`);
          return iconSvg(name, className);
        },
      );
      if (out.includes("data-icon=")) {
        throw new Error(
          `${ctx.path}: write icons as <svg class="icon" data-icon="name" aria-hidden="true"></svg>`,
        );
      }
      return out;
    },
  };
}

/**
 * The site pages from docs/site/*.md and protocol/src/site.ts (the one source for each):
 *
 * - the footer in place of `<!-- site:footer -->`,
 * - the homepage's JSON-LD (WebSite, Organization, WebApplication, FAQPage) in index.html,
 * - a Markdown twin for every page with `prose` (`/index.md`, `/about.md`, `/pricing.md`, ...),
 *   with frontmatter for title, description, canonical, and last-updated,
 * - static HTML for the `static` pages (`/about.html`, served at `/about`), with no scripts,
 * - a static page and a twin for each devlog post (`/devlog/2026-10-06.html` and `.md`), from the
 *   posts `pnpm gen` built into the protocol (decision 0105), each dated by its day.
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
  const posts = DEVLOG_POSTS.map((post) => ({
    page: devlogSitePage(post),
    source: devlogPostMarkdown(post),
    lastUpdated: post.date,
  }));

  return {
    name: "terrakin-site",
    transformIndexHtml(raw, ctx) {
      const html = raw.replaceAll("<!-- site:footer -->", footerHtml());
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
        for (const { page, source, lastUpdated } of posts) {
          if (path === `/${twinFile(page)}`) {
            res.setHeader("content-type", "text/markdown; charset=utf-8");
            return res.end(markdownTwin(page, source, lastUpdated));
          }
          if (path === page.path) {
            res.setHeader("content-type", "text/html; charset=utf-8");
            return res.end(staticPage({ page, source, lastUpdated, css: "/src/style.css" }));
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
      for (const { page, source, lastUpdated } of posts) {
        this.emitFile({
          type: "asset",
          fileName: twinFile(page),
          source: markdownTwin(page, source, lastUpdated),
        });
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

/**
 * The most the app's first load may weigh, gzipped: the entry script with every chunk it imports
 * up front, and their stylesheets. The build fails past it (decision 0110). Lazy chunks (3D, the
 * API reference, Markdown) don't count; they load when someone opens them.
 */
export const FIRST_LOAD_BUDGET = { js: 215_000, css: 32_000 } as const;

function firstLoadBudget(): Plugin {
  return {
    name: "terrakin-first-load-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (c) => c.type === "chunk" && c.isEntry && c.facadeModuleId?.endsWith("/index.html"),
      );
      // Only the app build: the docs build reuses this config for docs.html alone.
      if (entry?.type !== "chunk") return;
      const chunks = new Set<string>();
      const styles = new Set<string>();
      const visit = (fileName: string) => {
        const chunk = bundle[fileName];
        if (chunk?.type !== "chunk" || chunks.has(fileName)) return;
        chunks.add(fileName);
        for (const css of chunk.viteMetadata?.importedCss ?? []) styles.add(css);
        for (const next of chunk.imports) visit(next);
      };
      visit(entry.fileName);
      const gzipped = (files: Set<string>) =>
        [...files].reduce((sum, fileName) => {
          const out = bundle[fileName];
          const text = out?.type === "chunk" ? out.code : out?.source;
          return sum + (text === undefined ? 0 : gzipSync(text).length);
        }, 0);
      const js = gzipped(chunks);
      const css = gzipped(styles);
      const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;
      this.info(`first load: ${kb(js)} of script and ${kb(css)} of styles, gzipped`);
      if (js > FIRST_LOAD_BUDGET.js || css > FIRST_LOAD_BUDGET.css) {
        this.error(
          `The first load is ${kb(js)} of script and ${kb(css)} of styles gzipped, over the budget of ${kb(FIRST_LOAD_BUDGET.js)} and ${kb(FIRST_LOAD_BUDGET.css)}. Load the new code lazily with import(), or raise the budget in a decision record.`,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [icons(), sitePages(), contentSecurityPolicy(), firstLoadBudget()],
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
      // Link preview cards (/og/...png). Not /og.png, which is a static file Vite serves itself.
      "^/og/": { target: server },
    },
  },
});
