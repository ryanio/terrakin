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
import { apiPage, type DocsPage, docsPage, pageMarkdown } from "@terrakin/protocol/reference";
import { iconSvg, isIconName } from "@terrakin/ui/icons";
import { build, defineConfig, type Plugin } from "vite";
import { JSON_SCHEMA_MODULES, processorsStub, TO_JSON_SCHEMA_STUB } from "./src/no-json-schema";
import { footerHtml, markdownTwin, skillPageMarkdown, staticPage } from "./src/site-page";
import { stripDescribe } from "./src/strip-describe";

const server = process.env.TERRAKIN_SERVER ?? "http://localhost:8787";
const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/**
 * A Content-Security-Policy for the production build, as a meta tag at the top of every page
 * (index.html).
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
/** The docs pages: a static page's policy, but with our own scripts, for their copy buttons. */
const DOCS_PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

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
            throw new Error(`${ctx.path}: no icon "${name}" in packages/ui/src/icons.ts`);
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
 * The site pages from docs/site/*.md and packages/protocol/src/site.ts (the one source for each):
 *
 * - the footer in place of `<!-- site:footer -->`,
 * - the homepage's JSON-LD (WebSite, Organization, WebApplication, FAQPage) in index.html,
 * - a Markdown twin for every page with `prose` (`/index.md`, `/about.md`, `/pricing.md`, ...),
 *   with frontmatter for title, description, canonical, and last-updated,
 * - static HTML for the `static` pages (`/about.html`, served at `/about`), with no scripts,
 * - the docs (decision 0195): /docs from the generated guides and the API reference's index (its
 *   twin, /docs.md, is a file `pnpm gen` writes), a page and a twin for each area of the API and
 *   for its models (`/docs/api/world.html` and `.md`), from the OpenAPI document, and /docs/skill
 *   from SKILL.md (its twin is the API's /skill.md),
 * - a static page and a twin for each devlog post (`/devlog/2026-10-06.html` and `.md`), from the
 *   posts `pnpm gen` built into the protocol (decision 0105), each dated by its day.
 *
 * Dates come from docs/site/lastmod.json, which `pnpm gen` keeps.
 */
/**
 * The docs pages' one script (src/docs-copy.ts), bundled on its own rather than as a second entry
 * of the app, so the app's chunks and its first load never change for it. Named by its content.
 */
async function docsCopyScript(): Promise<{ fileName: string; code: string }> {
  const out = await build({
    configFile: false,
    logLevel: "warn",
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(new URL("./src/docs-copy.ts", import.meta.url)),
        formats: ["es"],
        fileName: "docs-copy",
      },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) =>
    "output" in o ? o.output : [],
  );
  const chunk = outputs.find((c) => c.type === "chunk" && c.isEntry);
  if (chunk?.type !== "chunk") throw new Error("terrakin-site: the docs script didn't build");
  const hash = createHash("sha256").update(chunk.code).digest("hex").slice(0, 8);
  return { fileName: `assets/docs-copy-${hash}.js`, code: chunk.code };
}

function sitePages(): Plugin {
  const prose = (PAGES as readonly SitePage[]).filter((p) => p.prose || p.built);
  const lastmod = () =>
    JSON.parse(readFileSync(repo("docs/site/lastmod.json"), "utf8")) as Record<
      string,
      { lastmod: string }
    >;
  const file = (path: string) => readFileSync(repo(path), "utf8");
  /** /docs and the API reference, in parts the page draws as more than text. */
  const docsOf = (page: SitePage): DocsPage | undefined => {
    if (page.built === "docs")
      return docsPage(file("packages/client/src/docs/guides.generated.md"));
    if (page.built === "api")
      return apiPage(page.path, JSON.parse(file("packages/protocol/openapi.json")));
    return undefined;
  };
  const read = (page: SitePage): string => {
    const docs = docsOf(page);
    if (docs) return pageMarkdown(docs);
    return page.built === "skill"
      ? skillPageMarkdown(file("packages/protocol/SKILL.md"))
      : file(`docs/site/${page.prose}.md`);
  };
  /** Whether the build writes the page's twin; /skill.md and /docs.md come from elsewhere. */
  const ownTwin = (page: SitePage) => page.prose !== undefined || page.built === "api";
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
          if (ownTwin(page) && path === `/${twinFile(page)}`) {
            res.setHeader("content-type", "text/markdown; charset=utf-8");
            return res.end(markdownTwin(page, read(page), dated(page)));
          }
          if (page.kind === "static" && path === page.path) {
            res.setHeader("content-type", "text/html; charset=utf-8");
            const css = "/src/style.css";
            const docs = docsOf(page);
            const script = docs ? "/src/docs-copy.ts" : undefined;
            return res.end(
              staticPage({ page, source: read(page), lastUpdated: dated(page), css, docs, script }),
            );
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
    async generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (c) => c.type === "chunk" && c.isEntry && c.facadeModuleId?.endsWith("/index.html"),
      );
      if (!entry) return;
      const css =
        entry?.type === "chunk" ? [...(entry.viteMetadata?.importedCss ?? [])][0] : undefined;
      if (!css) throw new Error("terrakin-site: no stylesheet for the static pages");
      const copy = await docsCopyScript();
      this.emitFile({ type: "asset", fileName: copy.fileName, source: copy.code });
      const docsScript = `/${copy.fileName}`;
      for (const page of prose) {
        const source = read(page);
        const lastUpdated = dated(page);
        if (!lastUpdated) throw new Error(`No lastmod for ${page.path}; run pnpm gen`);
        if (ownTwin(page)) {
          this.emitFile({
            type: "asset",
            fileName: twinFile(page),
            source: markdownTwin(page, source, lastUpdated),
          });
        }
        if (page.kind !== "static") continue;
        const docs = docsOf(page);
        const script = docs ? docsScript : undefined;
        const html = staticPage({ page, source, lastUpdated, css: `/${css}`, docs, script });
        this.emitFile({
          type: "asset",
          fileName: htmlFile(page),
          source: withCsp(html, script ? DOCS_PAGE_POLICY : STATIC_PAGE_POLICY),
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
 * up front, and their stylesheets. The build fails past it (decisions 0110 and 0231). Lazy chunks
 * (every page but the feed, the world, 3D, sound, avatar figures) don't count; they load when
 * someone opens them, or beside the first load.
 */
export const FIRST_LOAD_BUDGET = { js: 125_000, css: 32_000 } as const;

function firstLoadBudget(): Plugin {
  return {
    name: "terrakin-first-load-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (c) => c.type === "chunk" && c.isEntry && c.facadeModuleId?.endsWith("/index.html"),
      );
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

/**
 * Leave zod's JSON Schema code out of the build: the app only parses, and every classic schema
 * type would otherwise carry it into the first load (decision 0231). zod's classic schemas get a
 * stand-in for the two modules it lives in; `src/no-json-schema.ts` writes them.
 */
function noJsonSchema(): Plugin {
  const PROCESSORS = "\0terrakin-zod-processors";
  const TO_JSON_SCHEMA = "\0terrakin-zod-to-json-schema";
  let classic: string | undefined;
  return {
    name: "terrakin-no-json-schema",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer?.endsWith("/zod/v4/classic/schemas.js")) return null;
      if (source === JSON_SCHEMA_MODULES.processors) {
        classic = importer;
        return PROCESSORS;
      }
      return source === JSON_SCHEMA_MODULES.toJsonSchema ? TO_JSON_SCHEMA : null;
    },
    load(id) {
      if (id === TO_JSON_SCHEMA) return TO_JSON_SCHEMA_STUB;
      if (id !== PROCESSORS || !classic) return null;
      const real = fileURLToPath(new URL(JSON_SCHEMA_MODULES.processors, `file://${classic}`));
      return processorsStub(readFileSync(classic, "utf8"), real);
    },
  };
}

/**
 * Drop the protocol schemas' descriptions from the build: the app never reads them, and they are
 * kilobytes of every first load (decision 0163). Only `packages/protocol/src`, never a test.
 */
function noSchemaDescriptions(): Plugin {
  return {
    name: "terrakin-no-schema-descriptions",
    apply: "build",
    transform(code, id) {
      if (!/\/packages\/protocol\/src\/.+\.ts$/.test(id) || id.endsWith(".test.ts")) return null;
      if (!code.includes(".describe(")) return null;
      return { code: stripDescribe(code), map: null };
    },
  };
}

export default defineConfig({
  plugins: [
    noSchemaDescriptions(),
    noJsonSchema(),
    icons(),
    sitePages(),
    contentSecurityPolicy(),
    firstLoadBudget(),
  ],
  build: {
    // three.js lives in its own chunk (model-viewer), loaded only when someone opens a 3D model.
    chunkSizeWarningLimit: 700,
  },
  server: {
    // `pnpm dev:test` moves it, so a test world runs beside a plain `pnpm dev`.
    port: Number(process.env.TERRAKIN_CLIENT_PORT ?? 5173),
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
