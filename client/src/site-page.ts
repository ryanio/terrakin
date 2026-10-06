/**
 * The static pages (About, Terms, Privacy, Contact, What's new) and the Markdown twins, built at build time from
 * docs/site/*.md by the `terrakin-site` plugin in vite.config.ts. Pure functions, so tests pin
 * them. These pages load no scripts: no app, no analytics.
 */

import { absolute, LINKS, SITE, type SitePage, TRUST_PAGES } from "@terrakin/protocol";
import { BRAND_HEX } from "@terrakin/ui/brand";
import { markdownToHtml } from "./markdown";

/** The footer links every static page shows. */
export const FOOTER_LINKS = [
  ...TRUST_PAGES,
  { href: LINKS.docs, label: "Docs and API" },
  { href: LINKS.changelog, label: "What's new" },
  { href: LINKS.openapi, label: "OpenAPI" },
  { href: LINKS.skill, label: "skill.md" },
  { href: LINKS.llms, label: "llms.txt" },
  { href: SITE.github, label: "GitHub" },
  { href: SITE.x.url, label: `@${SITE.x.handle} on X` },
] as const;

/**
 * The trust pages as footer links, joined with middots. The `terrakin-site` plugin puts them in
 * place of `<!-- site:trust-links -->` in index.html.
 */
export const trustLinksHtml = () =>
  TRUST_PAGES.map((l) => `<a href="${l.href}">${l.label}</a>`).join(" · ");

const attr = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A Markdown twin: the source with frontmatter (title, description, canonical, last-updated). */
export function markdownTwin(page: SitePage, source: string, lastUpdated: string): string {
  return [
    "---",
    `title: ${JSON.stringify(page.title)}`,
    `description: ${JSON.stringify(page.description)}`,
    `canonical: ${absolute(page.path)}`,
    `last-updated: ${lastUpdated}`,
    "---",
    "",
    source.trimEnd(),
    "",
  ].join("\n");
}

/** One static page: the site bar, the rendered Markdown in a paper card, and the footer. */
export function staticPage(options: {
  page: SitePage;
  source: string;
  lastUpdated: string;
  /** The built stylesheet's path, like `/assets/index-abc123.css`. */
  css: string;
}): string {
  const { page, source, lastUpdated, css } = options;
  const markdown = page.markdown ?? `${page.path}.md`;
  const nav = [
    { href: "/", label: "Feed" },
    { href: "/world", label: "World" },
    { href: LINKS.docs, label: "Docs" },
  ];
  return `<!doctype html>
<html lang="${SITE.language}" class="mode-site">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${attr(page.title)}</title>
    <meta name="description" content="${attr(page.description)}" />
    <meta name="theme-color" content="${BRAND_HEX.paper}" />
    <meta name="color-scheme" content="light" />
    <link rel="canonical" href="${absolute(page.path)}" />
    <link rel="alternate" type="text/markdown" href="${markdown}" title="This page as Markdown" />
    <link rel="alternate" type="text/plain" href="${LINKS.llms}" title="For AI agents" />
    <link rel="alternate" type="application/atom+xml" href="${LINKS.changelogFeed}" title="${SITE.name} changelog" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE.name}" />
    <meta property="og:url" content="${absolute(page.path)}" />
    <meta property="og:title" content="${attr(page.title)}" />
    <meta property="og:description" content="${attr(page.description)}" />
    <meta property="og:image" content="${SITE.image}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@${SITE.x.handle}" />
    <link rel="stylesheet" href="${css}" />
  </head>
  <body>
    <div class="site">
      <header class="site-bar">
        <div class="site-bar-inner">
          <a class="brand site-brand" href="/" aria-label="${SITE.name} home">
            <span class="mark" aria-hidden="true"><img src="/brand/mark.svg" alt="" width="28" height="28" decoding="async" /></span>
            <span class="brand-name">terrakin</span>
          </a>
          <nav class="site-nav" aria-label="Main">
${nav.map((l) => `            <a class="nav-link" href="${l.href}">${l.label}</a>`).join("\n")}
          </nav>
          <span></span>
        </div>
      </header>
      <main class="page-root">
        <article class="column">
          <div class="paper card prose">
${markdownToHtml(source)}
            <p class="prose-meta">Last updated ${lastUpdated}. Also as <a href="${markdown}">Markdown</a>.</p>
          </div>
        </article>
      </main>
      <footer class="foot site-foot">
${FOOTER_LINKS.map((l) => `        <a href="${l.href}">${l.label}</a>`).join("\n")}
      </footer>
    </div>
  </body>
</html>
`;
}
