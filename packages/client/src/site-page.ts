/**
 * The static pages (About, Terms, Privacy, Contact, What's new, the devlog and each of its posts)
 * and the Markdown twins, built at build time from docs/site/*.md and the devlog's posts by the
 * `terrakin-site` plugin in vite.config.ts. Pure functions, so tests pin them. These pages load
 * no scripts: no app, no analytics.
 */

import {
  absolute,
  DEVLOG_POSTS,
  devlogDay,
  devlogPath,
  LINKS,
  SITE,
  type SitePage,
  TRUST_PAGES,
} from "@terrakin/protocol";
import { BRAND_HEX } from "@terrakin/ui/brand";
import { iconSvg } from "@terrakin/ui/icons";
import { markdownToHtml } from "./markdown";

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
function siteSideHtml(path: string): string {
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
  if (path === LINKS.devlog || posts.length === 0) return visit;
  const items = posts
    .map(
      (p) =>
        `<li class="stack tight"><a href="${devlogPath(p.date)}">${attr(p.title)}</a><span class="pulse-foot">${devlogDay(p.date)}</span></li>`,
    )
    .join("");
  return `${visit}
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
          <article class="layout-main">
            <div class="paper card prose">
${page.path === LINKS.devlog ? devlogEntries(markdownToHtml(source)) : markdownToHtml(source)}
              <p class="prose-meta">Last updated ${lastUpdated}. Also as <a href="${markdown}">Markdown</a>.</p>
            </div>
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
