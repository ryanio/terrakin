import { LINKS, PAGES, type PostView, type ProfileView, SITE } from "@terrakin/protocol";

/**
 * What the HTML for each page of the site says before any script runs: title, description,
 * canonical URL, Open Graph and Twitter tags, JSON-LD, and a `<noscript>` copy of the content for
 * crawlers that don't run JavaScript. One function builds it from API data; the Worker
 * (HTMLRewriter) and the Node server (`meta-html.ts`) only apply it to index.html.
 *
 * Pages with their own HTML file (`/docs`, and static pages like `/about`) keep their own tags and
 * only get their card.
 *
 * Names, bios and posts are untrusted (decision 0004). They only ever travel as plain strings in
 * `DocumentEdits`; each applier escapes them with its runtime's text and attribute APIs.
 */

export const SITE_ORIGIN = SITE.url;
export const SITE_NAME = SITE.name;

/** Title and description of a page from the one site config (protocol/src/site.ts). */
function sitePage(path: string): { title: string; description: string } {
  const page = PAGES.find((p) => p.path === path);
  return { title: page?.title ?? SITE.name, description: page?.description ?? SITE.description };
}

/**
 * Pages the client router knows (client/src/router.ts; keep the two in step), plus the pages that
 * are their own HTML file.
 */
export type Page =
  | { name: "home" }
  | { name: "world" }
  /** The Town Hall (RFC 0004). */
  | { name: "town" }
  | { name: "profile"; id: string }
  /** `/u/handle`: a profile by handle. Its canonical URL is still `/r/<id>`, which never changes. */
  | { name: "handle"; handle: string }
  | { name: "post"; id: string }
  /** `/docs` or a static page: its own HTML file with its own tags. `slug` names its card. */
  | { name: "site"; path: string; slug: string }
  /** Letters, invites, AI claim links, and notifications: one person's, behind a token or a code. Never indexed. */
  | { name: "private"; what: "letters" | "invite" | "claim" | "notifications" }
  | { name: "not-found" };

/** Paths served as their own HTML file rather than the app's index.html. */
export const OWN_DOCUMENTS: ReadonlySet<string> = new Set(
  PAGES.filter((p) => p.kind === "static" || p.path === LINKS.docs).map((p) => p.path),
);

const ID = "([A-Za-z0-9_-]{1,64})";
const PATTERNS: [RegExp, (m: RegExpExecArray) => Page][] = [
  [/^\/$/, () => ({ name: "home" })],
  [/^\/world$/, () => ({ name: "world" })],
  [/^\/town$/, () => ({ name: "town" })],
  [new RegExp(`^/r/${ID}$`), (m) => ({ name: "profile", id: m[1] ?? "" })],
  // The plot in 3D shares its profile's meta and canonical.
  [new RegExp(`^/r/${ID}/3d$`), (m) => ({ name: "profile", id: m[1] ?? "" })],
  // The hidden 3D gallery is an app view like the world.
  [/^\/gallery\/3d$/, () => ({ name: "world" })],
  [/^\/u\/([A-Za-z][A-Za-z0-9_]{2,19})$/, (m) => ({ name: "handle", handle: m[1] ?? "" })],
  [new RegExp(`^/p/${ID}$`), (m) => ({ name: "post", id: m[1] ?? "" })],
  [/^\/notifications$/, () => ({ name: "private", what: "notifications" })],
  [new RegExp(`^/letters(/${ID})?$`), () => ({ name: "private", what: "letters" })],
  [new RegExp(`^/i/${ID}$`), () => ({ name: "private", what: "invite" })],
  [new RegExp(`^/claim/${ID}$`), () => ({ name: "private", what: "claim" })],
];

/**
 * Where an old address lives now, for a 301: `/@handle` moved to `/u/handle`. Undefined for
 * everything else. The Worker and the Node server both answer with it.
 */
export function legacyRedirect(pathname: string): string | undefined {
  const handle = /^\/@([A-Za-z][A-Za-z0-9_]{2,19})\/?$/.exec(pathname)?.[1];
  return handle ? `/u/${handle}` : undefined;
}

/** Which page a path is, the same way the client router decides. Trailing slashes are ignored. */
export function matchPage(pathname: string): Page {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  for (const [pattern, make] of PATTERNS) {
    const m = pattern.exec(path);
    if (m) return make(m);
  }
  if (OWN_DOCUMENTS.has(path)) return { name: "site", path, slug: path.slice(1) };
  return { name: "not-found" };
}

// ---------- loading ----------

/** A GET against the API: the Worker asks the World object, Node calls `Api.handle` directly. */
export type ApiGet = (path: string) => Promise<{ status: number; body: unknown }>;

export type Loaded =
  | { page: { name: "home" | "world" | "town" | "not-found" } }
  | { page: { name: "site"; path: string; slug: string } }
  | { page: { name: "private"; what: "letters" | "invite" | "claim" | "notifications" } }
  | { page: { name: "profile"; id: string }; profile: ProfileView; posts: PostView[] }
  | { page: { name: "post"; id: string }; post: PostView; replies: PostView[] }
  /** The API said there's no such resident or post. */
  | { page: Page; missing: true }
  /** The API didn't answer. The page keeps index.html's own tags, so a hiccup never says 404. */
  | { page: Page; unavailable: true };

async function getJson<T>(get: ApiGet, path: string): Promise<T | "missing" | "unavailable"> {
  try {
    const { status, body } = await get(path);
    if (status === 404) return "missing";
    if (status !== 200) return "unavailable";
    return body as T;
  } catch {
    return "unavailable";
  }
}

export async function loadPage(page: Page, get: ApiGet): Promise<Loaded> {
  if (page.name === "handle") {
    const found = await getJson<{ resident: ProfileView }>(
      get,
      `/v1/residents/by-handle/${encodeURIComponent(page.handle)}`,
    );
    if (found === "missing") return { page, missing: true };
    if (found === "unavailable") return { page, unavailable: true };
    // From here it's the profile page, so its tags (and canonical URL) are the profile's.
    return loadPage({ name: "profile", id: found.resident.id }, get);
  }
  if (page.name === "profile") {
    const id = encodeURIComponent(page.id);
    const [profile, posts] = await Promise.all([
      getJson<{ resident: ProfileView }>(get, `/v1/residents/${id}`),
      getJson<{ posts: PostView[] }>(get, `/v1/residents/${id}/posts?limit=10`),
    ]);
    if (profile === "missing") return { page, missing: true };
    if (profile === "unavailable") return { page, unavailable: true };
    return {
      page,
      profile: profile.resident,
      posts: typeof posts === "string" ? [] : posts.posts,
    };
  }
  if (page.name === "post") {
    const res = await getJson<{ post: PostView; replies: PostView[] }>(
      get,
      `/v1/posts/${encodeURIComponent(page.id)}`,
    );
    if (res === "missing") return { page, missing: true };
    if (res === "unavailable") return { page, unavailable: true };
    return { page, post: res.post, replies: res.replies };
  }
  if (page.name === "site") return { page };
  if (page.name === "private") return { page };
  return { page: { name: page.name } };
}

// ---------- the edits ----------

/**
 * One element of the `<noscript>` copy. `text` is untrusted and only ever goes through the
 * applier's text escaping. `href` is a path on this site built from an id with
 * `encodeURIComponent`, never free text.
 */
export type Block =
  | { tag: "h1" | "h2" | "p"; text: string }
  | { tag: "a"; text: string; href: string }
  | { tag: "time"; text: string; datetime: string }
  /** A list; each item is a row of inline blocks (links, separated by " · "). */
  | { tag: "ul"; items: Block[][] };

/** A run of the noscript copy: our own markup, or untrusted text the applier must escape. */
export type Part = { markup: string } | { text: string };

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The noscript copy as markup and text runs, in order. Markup is built from fixed tag names and
 * site paths only; every resident-written string stays a `text` run. Both appliers consume this,
 * so they can't drift apart.
 */
export function noscriptParts(blocks: Block[]): Part[] {
  const parts: Part[] = [];
  const walk = (b: Block) => {
    if (b.tag === "ul") {
      parts.push({ markup: "<ul>" });
      for (const row of b.items) {
        parts.push({ markup: "<li>" });
        row.forEach((inline, i) => {
          if (i > 0) parts.push({ text: " · " });
          walk(inline);
        });
        parts.push({ markup: "</li>" });
      }
      parts.push({ markup: "</ul>" });
      return;
    }
    const attrs =
      b.tag === "a"
        ? ` href="${escapeAttr(b.href)}"`
        : b.tag === "time"
          ? ` datetime="${escapeAttr(b.datetime)}"`
          : "";
    parts.push({ markup: `<${b.tag}${attrs}>` }, { text: b.text }, { markup: `</${b.tag}>` });
  };
  if (!blocks.length) return parts;
  parts.push({ markup: '<article class="noscript-page">' });
  for (const b of blocks) walk(b);
  parts.push({ markup: "</article>" });
  return parts;
}

export interface DocumentEdits {
  status: 200 | 404;
  /** The new `<title>` text, or undefined to keep the file's own. */
  title: string | undefined;
  /** Attribute values to set on tags that already exist in client/index.html. */
  attributes: { selector: string; name: string; value: string }[];
  /** Selectors of tags to drop (a 404 has no canonical URL). */
  remove: string[];
  /**
   * The page's JSON-LD. index.html carries the homepage's (site, organization, FAQ); other pages
   * replace it with their own (`set`, already safe inside a `<script>`: see `scriptJson()`) or
   * drop it (`remove`), so a profile never claims the homepage's FAQ.
   */
  jsonLd: { set: string } | "remove" | "keep";
  /** Content for the `<noscript>` in the body, for crawlers without JavaScript. */
  noscript: Block[];
}

/** The tags `pageEdits` sets. All exist in client/index.html (a test checks). */
export const META_SELECTORS = {
  description: 'meta[name="description"]',
  robots: 'meta[name="robots"]',
  canonical: 'link[rel="canonical"]',
  ogType: 'meta[property="og:type"]',
  ogUrl: 'meta[property="og:url"]',
  ogTitle: 'meta[property="og:title"]',
  ogDescription: 'meta[property="og:description"]',
  ogImage: 'meta[property="og:image"]',
  ogImageAlt: 'meta[property="og:image:alt"]',
  twitterTitle: 'meta[name="twitter:title"]',
  twitterDescription: 'meta[name="twitter:description"]',
  twitterImage: 'meta[name="twitter:image"]',
  twitterImageAlt: 'meta[name="twitter:image:alt"]',
} as const;

/** The card a page shows when shared: its path under /og/ and the alt text. */
export interface PageImage {
  url: string;
  alt: string;
}

/**
 * JSON for inside a `<script type="application/ld+json">`. `<`, `>` and `&` become unicode
 * escapes, so no value can close the script or open a comment; U+2028 and U+2029 too.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Cuts text to `max` characters on a word boundary, with an ellipsis. Whitespace collapses. */
export function excerpt(s: string, max: number): string {
  const chars = [...s.replace(/\s+/g, " ").trim()];
  if (chars.length <= max) return chars.join("");
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?'"(-]+$/, "")}…`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A media id from one of our media URLs (`/media/m_` plus 16 hex), or undefined. */
export function mediaId(url: string | null | undefined): string | undefined {
  return /^\/media\/(m_[0-9a-f]{16})$/.exec(url ?? "")?.[1];
}

interface Meta {
  status: 200 | 404;
  title: string;
  description: string;
  /** Path of the canonical URL, or undefined for a page that doesn't exist or is private. */
  path: string | undefined;
  /** Keep it out of search: missing and private pages. */
  noindex?: boolean;
  type: "website" | "profile" | "article";
  image: PageImage;
  /** The page's own JSON-LD, or "keep" for the homepage's. Pages without either drop it. */
  jsonLd?: unknown;
  noscript?: Block[];
}

/**
 * The edits for a page. `image` is its card (from `og.ts`), so the version in the card's URL
 * matches what the card shows. With `unavailable` data, index.html's own tags stay.
 */
export function pageEdits(loaded: Loaded, image: PageImage): DocumentEdits | undefined {
  if ("unavailable" in loaded) return undefined;
  if (loaded.page.name === "site") {
    // Its own HTML file, with its own title and tags: only the card changes.
    const s = META_SELECTORS;
    return {
      status: 200,
      title: undefined,
      attributes: [
        { selector: s.ogImage, name: "content", value: image.url },
        { selector: s.ogImageAlt, name: "content", value: image.alt },
        { selector: s.twitterImage, name: "content", value: image.url },
        { selector: s.twitterImageAlt, name: "content", value: image.alt },
      ],
      remove: [],
      jsonLd: "keep",
      noscript: [],
    };
  }
  return toEdits(meta(loaded, image));
}

function meta(loaded: Loaded, image: PageImage): Meta {
  if ("missing" in loaded || loaded.page.name === "not-found") {
    return {
      status: 404,
      title: `Not found · ${SITE_NAME}`,
      description: "There's nothing here. It may have been deleted, or the link has a typo.",
      path: undefined,
      type: "website",
      image,
    };
  }
  if (loaded.page.name === "private") {
    const { what } = loaded.page;
    return {
      status: 200,
      title:
        what === "letters"
          ? `Letters · ${SITE_NAME}`
          : what === "claim"
            ? `Claim your AI · ${SITE_NAME}`
            : what === "notifications"
              ? `Notifications · ${SITE_NAME}`
              : `An invitation to ${SITE_NAME}`,
      description:
        what === "letters"
          ? "Private letters between residents of Terrakin."
          : what === "claim"
            ? "An AI says it's yours. Confirm it on Terrakin, a small world where people and their AI assistants build homes together."
            : what === "notifications"
              ? "Mentions, replies, reactions, and follows for one resident of Terrakin."
              : "Someone invited you to Terrakin, a small world where people and their AI assistants build homes together.",
      path: undefined,
      noindex: true,
      type: "website",
      image,
    };
  }
  if ("profile" in loaded) return profileMeta(loaded.profile, loaded.posts, image);
  if ("post" in loaded) return postMeta(loaded.post, loaded.replies, image);
  if (loaded.page.name === "town") {
    return {
      status: 200,
      title: `Town Hall · ${SITE_NAME}`,
      description:
        "Residents of Terrakin propose ideas and builds for the Commons and vote on them. Passed builds appear in the world.",
      path: "/town",
      type: "website",
      image,
    };
  }
  if (loaded.page.name === "world") {
    return { status: 200, ...sitePage("/world"), path: "/world", type: "website", image };
  }
  return {
    status: 200,
    ...sitePage("/"),
    path: "/",
    type: "website",
    image,
    jsonLd: "keep",
  };
}

function profileMeta(r: ProfileView, posts: PostView[], image: PageImage): Meta {
  const path = `/r/${encodeURIComponent(r.id)}`;
  const url = SITE_ORIGIN + path;
  const what = r.kind === "agent" ? "an AI resident" : "a resident";
  const about = r.bio || r.note;
  const counts = `${plural(r.posts, "post")}, ${plural(r.followers, "follower")}.`;
  const description = about
    ? excerpt(`${about} (${counts.slice(0, -1)})`, 200)
    : `${r.name} is ${what} of Terrakin, a small shared world where people and their AI assistants build homes together. ${counts}`;
  const avatar = mediaId(r.avatar);
  const person = {
    "@type": "Person",
    "@id": `${url}#person`,
    name: r.name,
    identifier: r.id,
    url,
    ...(about ? { description: about } : {}),
    ...(avatar ? { image: `${SITE_ORIGIN}/media/${avatar}` } : {}),
    // A connected X account (decision 0022): the handle passed X_HANDLE when it was stored.
    ...(r.x ? { sameAs: [`https://x.com/${encodeURIComponent(r.x.handle)}`] } : {}),
    ...(r.kind === "agent" ? { disambiguatingDescription: "An AI agent living in Terrakin" } : {}),
    interactionStatistic: [counter("FollowAction", r.followers)],
    agentInteractionStatistic: [
      counter("WriteAction", r.posts),
      counter("FollowAction", r.following),
    ],
  };
  const noscript: Block[] = [
    { tag: "h1", text: r.name },
    { tag: "p", text: r.kind === "agent" ? "AI resident of Terrakin" : "Resident of Terrakin" },
    ...(about ? [{ tag: "p" as const, text: about }] : []),
    {
      tag: "p",
      text: `${plural(r.posts, "post")} · ${plural(r.followers, "follower")} · ${r.following.toLocaleString("en-US")} following`,
    },
    ...postList(posts, false),
    { tag: "a", text: "Terrakin home", href: "/" },
  ];
  return {
    status: 200,
    title: `${r.name} on ${SITE_NAME}`,
    description,
    path,
    type: "profile",
    image,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      "@id": url,
      url,
      name: `${r.name} on ${SITE_NAME}`,
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
      mainEntity: person,
    },
    noscript,
  };
}

function postMeta(p: PostView, replies: PostView[], image: PageImage): Meta {
  const path = `/p/${encodeURIComponent(p.id)}`;
  const url = SITE_ORIGIN + path;
  const author = `/r/${encodeURIComponent(p.author.id)}`;
  const text = p.text.replace(/\s+/g, " ").trim();
  const photo = p.media.find((m) => m.kind === "image");
  const photoId = mediaId(photo?.url);
  const said = text ? `: "${excerpt(text, 60)}"` : "";
  const noscript: Block[] = [
    { tag: "a", text: p.author.name, href: author },
    { tag: "p", text: p.text },
    { tag: "time", text: p.createdAt.slice(0, 10), datetime: p.createdAt },
    {
      tag: "p",
      text: `${plural(p.likeCount, "like")} · ${plural(p.replyCount, "reply", "replies")}`,
    },
    ...(p.replyTo
      ? [
          {
            tag: "a" as const,
            text: "The post this replies to",
            href: `/p/${encodeURIComponent(p.replyTo)}`,
          },
        ]
      : []),
    ...postList(replies, true),
    { tag: "a", text: "Terrakin home", href: "/" },
  ];
  return {
    status: 200,
    title: `${p.author.name} on ${SITE_NAME}${said}`,
    description: text
      ? excerpt(text, 200)
      : `A post by ${p.author.name} on Terrakin, a small shared world where people and their AI assistants build homes together.`,
    path,
    type: "article",
    image,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "DiscussionForumPosting",
      "@id": url,
      url,
      mainEntityOfPage: url,
      headline: text ? excerpt(text, 110) : `A post by ${p.author.name}`,
      ...(text ? { text: p.text } : {}),
      datePublished: p.createdAt,
      author: { "@type": "Person", name: p.author.name, url: SITE_ORIGIN + author },
      ...(photoId ? { image: `${SITE_ORIGIN}/media/${photoId}` } : {}),
      ...(p.replyTo ? { isPartOf: `${SITE_ORIGIN}/p/${encodeURIComponent(p.replyTo)}` } : {}),
      commentCount: p.replyCount,
      interactionStatistic: [
        counter("LikeAction", p.likeCount),
        counter("CommentAction", p.replyCount),
      ],
    },
    noscript,
  };
}

function counter(action: string, count: number) {
  return {
    "@type": "InteractionCounter",
    interactionType: `https://schema.org/${action}`,
    userInteractionCount: count,
  };
}

/** A list of links to posts: the profile's latest, or a post's replies with who wrote them. */
function postList(posts: PostView[], byAuthor: boolean): Block[] {
  if (!posts.length) return [];
  const items = posts.slice(0, 10).map((p): Block[] => {
    const link: Block = {
      tag: "a",
      text: excerpt(p.text, 120) || "A post",
      href: `/p/${encodeURIComponent(p.id)}`,
    };
    const author: Block = {
      tag: "a",
      text: p.author.name,
      href: `/r/${encodeURIComponent(p.author.id)}`,
    };
    return byAuthor ? [author, link] : [link];
  });
  return [
    { tag: "h2", text: byAuthor ? "Replies" : "Recent posts" },
    { tag: "ul", items },
  ];
}

function toEdits(m: Meta): DocumentEdits {
  const s = META_SELECTORS;
  const set = (selector: string, value: string, name = "content") => ({ selector, name, value });
  const url = m.path === undefined ? undefined : SITE_ORIGIN + m.path;
  const attributes = [
    set(s.description, m.description),
    set(
      s.robots,
      m.status === 404 || m.noindex ? "noindex" : "index, follow, max-image-preview:large",
    ),
    set(s.ogType, m.type),
    set(s.ogTitle, m.title),
    set(s.ogDescription, m.description),
    set(s.ogImage, m.image.url),
    set(s.ogImageAlt, m.image.alt),
    set(s.twitterTitle, m.title),
    set(s.twitterDescription, m.description),
    set(s.twitterImage, m.image.url),
    set(s.twitterImageAlt, m.image.alt),
    ...(url ? [set(s.canonical, url, "href"), set(s.ogUrl, url)] : []),
  ];
  return {
    status: m.status,
    title: m.title,
    attributes,
    remove: url ? [] : [s.canonical, s.ogUrl],
    jsonLd:
      m.jsonLd === "keep"
        ? "keep"
        : m.jsonLd === undefined
          ? "remove"
          : { set: scriptJson(m.jsonLd) },
    noscript: m.noscript ?? [],
  };
}
