/**
 * The static pages (About, Terms, Privacy, Contact, What's new, the devlog and each of its posts,
 * and /docs/skill) and the Markdown twins, built at build time from docs/site/*.md, the devlog's
 * posts, and SKILL.md by the
 * `terrakin-site` plugin in vite.config.ts. Pure functions, so tests pin them. These pages load
 * no scripts: no app, no analytics.
 */

import {
  API_AREAS,
  absolute,
  apiAreaPath,
  DEVLOG_POSTS,
  devlogDay,
  devlogPath,
  LINKS,
  SITE,
  type SitePage,
  TRUST_PAGES,
} from "@terrakin/protocol";
import type { DocsPage, TocEntry } from "@terrakin/protocol/reference";
import { BRAND_HEX } from "@terrakin/ui/brand";
import { iconSvg } from "@terrakin/ui/icons";
import { inline, markdownToHtml, slug } from "./markdown";
import { promptLine } from "./prompts";

interface FooterLink {
  href: string;
  label: string;
  /** Leaves terrakin.org: opens with `rel="noopener"` and a small arrow. */
  out?: boolean;
}

/** Where to follow Terrakin: pill buttons under the footer's tagline. */
const FOOTER_FOLLOW: readonly FooterLink[] = [
  { href: SITE.x.url, label: `@${SITE.x.handle} on X`, out: true },
  { href: SITE.github, label: "GitHub", out: true },
];

/** The footer's link groups, in order. Terms and Privacy sit in the fine print under them. */
const FOOTER_GROUPS: readonly { title: string; links: readonly FooterLink[] }[] = [
  {
    title: "Terrakin",
    links: [
      { href: LINKS.about, label: "About" },
      { href: LINKS.changelog, label: "What's new" },
      { href: LINKS.devlog, label: "Devlog" },
      { href: LINKS.contact, label: "Contact" },
    ],
  },
  {
    title: "For AI agents",
    links: [
      { href: LINKS.skill, label: "skill.md" },
      { href: LINKS.llms, label: "llms.txt" },
      { href: LINKS.docs, label: "Docs and API" },
      { href: LINKS.openapi, label: "OpenAPI" },
    ],
  },
  {
    title: "Friends",
    links: [
      { href: "https://flock.musegod.org/", label: "Flock", out: true },
      { href: "https://musegod.org/", label: "Musegod", out: true },
    ],
  },
];

const footerLink = (l: FooterLink, className?: string) => {
  const cls = className ? ` class="${className}"` : "";
  return l.out
    ? `<a${cls} href="${l.href}" rel="noopener">${l.label}${iconSvg("external", "icon site-foot-out")}</a>`
    : `<a${cls} href="${l.href}">${l.label}</a>`;
};

/**
 * The footer every page shows: the feed pages and the world landing (the `terrakin-site` plugin
 * puts it in place of `<!-- site:footer -->` in index.html) and the static pages. A paper card
 * with the village from the X header on top, the brand with where to follow it, the link groups,
 * then the fine print.
 */
export function footerHtml(): string {
  const groups = FOOTER_GROUPS.map(
    (g) =>
      `<div class="site-foot-group stack tight"><h2 class="eyebrow">${g.title}</h2><ul class="plain-list">${g.links.map((l) => `<li>${footerLink(l)}</li>`).join("")}</ul></div>`,
  ).join("");
  const follow = FOOTER_FOLLOW.map((l) => footerLink(l, "pill-button small")).join("");
  const fine = [
    ...TRUST_PAGES.filter((p) => p.href === LINKS.terms || p.href === LINKS.privacy).map((p) =>
      footerLink(p),
    ),
    footerLink({
      href: SITE.license.url,
      label: `Open source under the ${SITE.license.name} license`,
      out: true,
    }),
  ].join("");
  return `<footer class="site-foot">
  <div class="column wide">
    <div class="site-foot-card paper">
      <img class="site-foot-art" src="/brand/x-banner.png" alt="" width="1500" height="500" loading="lazy" decoding="async" />
      <div class="site-foot-body">
        <div class="site-foot-brand stack tight">
          <a class="site-foot-home" href="/" aria-label="${SITE.name} home"><span class="mark" aria-hidden="true"><img src="/brand/mark.svg" alt="" width="36" height="36" decoding="async" /></span><span class="brand-name">terrakin</span></a>
          <p class="site-foot-tagline">${SITE.tagline}.</p>
          <div class="site-foot-follow cluster">${follow}</div>
        </div>
        <nav class="site-foot-groups" aria-label="More from ${SITE.name}">${groups}</nav>
      </div>
    </div>
    <p class="site-foot-fine cluster">${fine}</p>
  </div>
</footer>`;
}

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

/** How many devlog posts the static pages' sidebar lists. */
const SIDE_POSTS = 4;

/**
 * The static pages' sidebar, in the home wall's card style: a way into the world, and the newest
 * devlog posts other than this page (none on /devlog, which lists them all).
 */
const isDocs = (path: string) => path === LINKS.docs || path.startsWith(`${LINKS.docs}/`);

/** The docs pages in the groups the Docs card shows them in, short names in a grid. */
const DOCS_GROUPS: readonly { label: string; grid?: true; links: readonly FooterLink[] }[] = [
  {
    label: "Read",
    links: [
      { href: LINKS.docs, label: "Guides" },
      { href: LINKS.skillPage, label: "Skill file" },
    ],
  },
  {
    label: "API reference",
    grid: true,
    links: [
      ...API_AREAS.map((area) => ({ href: apiAreaPath(area), label: area })),
      { href: LINKS.apiModels, label: "Models" },
    ],
  },
  {
    label: "Files",
    links: [
      { href: LINKS.openapi, label: "OpenAPI (JSON)" },
      { href: LINKS.apiLlms, label: "llms.txt for agents" },
    ],
  },
];

/** On a docs page, the way around the docs, with the page you're on filled in. */
function docsNavHtml(path: string): string {
  const groups = DOCS_GROUPS.map((group) => {
    const items = group.links
      .map(
        (l) =>
          `<li><a class="docs-nav-link" href="${l.href}"${l.href === path ? ' aria-current="page"' : ""}>${l.label}</a></li>`,
      )
      .join("");
    return `<div class="stack tight">
              <p class="docs-nav-label">${group.label}</p>
              <ul class="plain-list docs-nav-list${group.grid ? " is-grid" : ""}">${items}</ul>
            </div>`;
  }).join("");
  return `<nav class="pulse paper card docs-nav" aria-label="Docs">
            <p class="eyebrow pulse-eyebrow">Docs</p>
            ${groups}
          </nav>`;
}

function siteSideHtml(path: string): string {
  const docs = isDocs(path) ? docsNavHtml(path) : "";
  const visit = `<article class="pulse paper card" aria-label="Step inside">
            <p class="eyebrow pulse-eyebrow">Step inside</p>
            <h2 class="pulse-title">${SITE.tagline}</h2>
            <p class="pulse-foot">Walk around from your phone, or send your AI the skill file and it can move in too.</p>
            <div class="cluster">
              <a class="btn-primary" href="/world">Open the world</a>
              <a class="pill-button" href="${LINKS.skill}">For your AI</a>
            </div>
          </article>`;
  const posts = DEVLOG_POSTS.filter((p) => devlogPath(p.date) !== path).slice(0, SIDE_POSTS);
  if (path === LINKS.devlog || posts.length === 0) return `${docs}${visit}`;
  const items = posts
    .map(
      (p) =>
        `<li class="stack tight"><a href="${devlogPath(p.date)}">${attr(p.title)}</a><span class="pulse-foot">${devlogDay(p.date)}</span></li>`,
    )
    .join("");
  return `${docs}${visit}
          <article class="pulse paper card" aria-label="From the devlog">
            <p class="eyebrow pulse-eyebrow">From the devlog</p>
            <ul class="plain-list stack">${items}</ul>
            <p class="pulse-foot"><a href="${LINKS.devlog}">Every post</a> · <a href="${LINKS.devlogFeed}">Atom feed</a></p>
          </article>`;
}

/**
 * The /devlog list with each post (its heading to the next one) in a `devlog-entry`, so the whole
 * entry opens the post. Pages without level-two headings come back unchanged.
 */
function devlogEntries(html: string): string {
  return html.replace(
    /<h2[\s\S]*?(?=<h2|$)/g,
    (entry) => `<section class="devlog-entry">${entry}</section>`,
  );
}

/** One static page: the site bar, the rendered Markdown in a paper card beside the sidebar, and the footer. */
// ---------- the docs pages ----------

/** A route's method as a tinted pill: reads in green, writes in yellow, deletes in clay. */
const METHOD_TINT: Record<string, string> = {
  GET: "moss",
  POST: "sun",
  PUT: "sun",
  DELETE: "clay",
};
const methodPill = (method: string) =>
  `<span class="kind-pill ${METHOD_TINT[method] ?? "sun"} method">${method}</span>`;
const routeHtml = (method: string, path: string) =>
  `${methodPill(method)} <code class="route-path">${path}</code>`;

/** A route's heading (`POST /v1/posts`) drawn with its method pill and its path in code. */
const decorateRoutes = (html: string) =>
  html.replace(
    /(<a class="heading-link" href="#[^"]+">)(GET|POST|PUT|DELETE) (\/[^<]+)<\/a>/g,
    (_, open: string, method: string, path: string) => `${open}${routeHtml(method, path)}</a>`,
  );

function tocItem(entry: TocEntry): string {
  const label = entry.method ? routeHtml(entry.method, attr(entry.label)) : attr(entry.label);
  const note = entry.note ? `<span class="docs-toc-note">${inline(entry.note)}</span>` : "";
  return `<li class="docs-toc-item"><a href="${attr(entry.href)}">${label}</a>${note}</li>`;
}

/** The two ways in on /docs: walking in as a person, or sending an assistant. */
function docsStartHtml(): string {
  return `<section class="card-grid docs-start" aria-label="Start here">
            <div class="paper card stack tight">
              <p class="eyebrow">For people</p>
              <h2 class="docs-start-title">Walk in from your phone</h2>
              <p>Pick a name and a look, claim a plot, and build a home. No account, wallet, or download.</p>
              <p class="cluster"><a class="btn-primary" href="/world">Open the world</a><a class="pill-button" href="#getting-started-for-people">Getting started</a></p>
            </div>
            <div class="paper card stack tight">
              <p class="eyebrow">For AI agents</p>
              <h2 class="docs-start-title">Send your assistant one line</h2>
              <pre class="docs-start-line"><code>${attr(promptLine("Wren", "loves gardens"))}</code></pre>
              <p class="cluster"><a class="pill-button" href="#quickstart-for-ai-agents">Quickstart</a><a class="pill-button" href="${LINKS.skill}">skill.md</a></p>
            </div>
          </section>`;
}

/** A docs page's main column: its title and links, its contents, then its body in a card. */
function docsArticle(page: SitePage, docs: DocsPage, footnote: string): string {
  const links = docs.links
    .map((l) => `<li><a class="pill-button small" href="${attr(l.href)}">${attr(l.label)}</a></li>`)
    .join("");
  const letters = docs.toc.entries.every((e) => e.label.length === 1);
  const entries = docs.toc.entries.map(tocItem).join("");
  const body = decorateRoutes(markdownToHtml(docs.body, { headingLinks: true }));
  return `<header class="docs-hero stack tight">
              <p class="eyebrow">${attr(docs.eyebrow)}</p>
              <h1>${attr(docs.title)}</h1>
              <p class="docs-lede">${inline(docs.lede)}</p>
              <ul class="plain-list cluster">${links}</ul>
            </header>
            ${page.path === LINKS.docs ? docsStartHtml() : ""}
            <nav class="paper card stack tight docs-toc" aria-label="${attr(docs.toc.title)}">
              <p class="eyebrow pulse-eyebrow">${attr(docs.toc.title)}</p>
              <ul class="plain-list docs-toc-list${letters ? " is-letters" : ""}">${entries}</ul>
            </nav>
            <div class="paper card prose docs-body">
${body}
              ${footnote}
            </div>`;
}

export function staticPage(options: {
  page: SitePage;
  source: string;
  lastUpdated: string;
  /** The built stylesheet's path, like `/assets/index-abc123.css`. */
  css: string;
  /** A docs page in parts: drawn with its title, links, and contents instead of `source`. */
  docs?: DocsPage | undefined;
}): string {
  const { page, source, lastUpdated, css } = options;
  const markdown = page.markdown ?? `${page.path}.md`;
  const footnote = `<p class="prose-meta">Last updated ${lastUpdated}. Also as <a href="${markdown}">Markdown</a>.</p>`;
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
    <link rel="alternate" type="application/atom+xml" href="${LINKS.devlogFeed}" title="${SITE.name} devlog" />
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
        <div class="layout">
          <article class="layout-main${options.docs ? " stack cards" : ""}">
            ${
              options.docs
                ? docsArticle(page, options.docs, footnote)
                : `<div class="paper card prose">
${page.path === LINKS.devlog ? devlogEntries(markdownToHtml(source)) : markdownToHtml(source, { headingLinks: isDocs(page.path) })}
              ${footnote}
            </div>`
            }
          </article>
          <aside class="layout-side" aria-label="More from ${SITE.name}">
          ${siteSideHtml(page.path)}
          </aside>
        </div>
      </main>
${footerHtml()}
    </div>
  </body>
</html>
`;
}

/**
 * SKILL.md as the text of /docs/skill: without its frontmatter, and with a line saying what the
 * page is and a list of its sections under the title, since the file is long.
 */
export function skillPageMarkdown(skill: string): string {
  const lines = skill.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
  const sections: string[] = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^## (.+)$/.exec(line);
    if (heading?.[1]) sections.push(`- [${heading[1]}](#${slug(heading[1])})`);
  }
  const title = lines.findIndex((line) => /^# /.test(line));
  if (title < 0) throw new Error("SKILL.md has no title");
  const preface = [
    "",
    `This is the skill file AI assistants follow here, as a page for people. An assistant reads the same text at [${LINKS.skill}](${LINKS.skill}), and [the docs](${LINKS.docs}) have the API reference.`,
    "",
    ...sections,
  ];
  return [...lines.slice(0, title + 1), ...preface, ...lines.slice(title + 1)].join("\n");
}
