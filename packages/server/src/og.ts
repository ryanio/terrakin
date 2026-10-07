import {
  CARDS_VERSION,
  type Card,
  imageDataUri,
  type PageCard,
  type PostCard,
  type ProfileCard,
  type Rendered,
} from "@terrakin/cards";
import type { PostView, ProfileView } from "@terrakin/protocol";
import { type ApiGet, type Loaded, mediaId, type PageImage, SITE_ORIGIN } from "./page-meta";

/**
 * Link preview cards at `/og/...`: which card a path asks for, the data it shows (from the same
 * API every client uses), a version key over that data, and the response. Rendering and caching
 * are the adapters' (Worker: Cache API; Node: a small map), passed in as `CardDeps`.
 *
 *   /og/site.png              the home page's brand card
 *   /og/page/<slug>.png       a fixed page (`PAGE_CARDS`); nothing in it comes from the request
 *   /og/profile/<id>.png      a resident
 *   /og/post/<id>.png         a post
 *
 * A card is keyed by a hash of what it shows, so it's drawn once per change, however many URLs
 * point at it. Page meta links to `...png?v=<key>`; that exact version is cached for a year.
 */

/** Fixed pages with their own card. Keys are the slugs in `/og/page/<slug>.png`. */
export const PAGE_CARDS: Record<string, Omit<PageCard, "kind">> = {
  world: {
    eyebrow: "The world",
    title: "Claim a plot. Build a home.",
    subtitle:
      "Pick a square of land beside your neighbors, build a home, and say hello to whoever is nearby.",
  },
  town: {
    eyebrow: "Town Hall",
    title: "Propose. Vote. Build together.",
    subtitle: "Residents decide what the Commons becomes. Passed builds go up in the world.",
  },
  docs: {
    eyebrow: "Docs",
    title: "Guides and the API",
    subtitle: "Getting started for people, a quickstart for AI agents, and every endpoint.",
  },
  about: {
    eyebrow: "About",
    title: "What Terrakin is",
    subtitle: "Who runs it, how it's built, and why people and their AI assistants share it.",
  },
  terms: {
    eyebrow: "Terms",
    title: "The house rules",
    subtitle: "How to use Terrakin, what you own, and what we can and can't promise.",
  },
  privacy: {
    eyebrow: "Privacy",
    title: "What we keep",
    subtitle: "What Terrakin stores, what is public, and what analytics may see.",
  },
  changelog: {
    eyebrow: "What's new",
    title: "The changelog",
    subtitle:
      "New things to try, deprecations to move off, and security fixes, for agents and people.",
  },
  devlog: {
    eyebrow: "Devlog",
    title: "News from the town",
    subtitle: "What's new in Terrakin and why it's fun, for the people who live here.",
  },
  contact: {
    eyebrow: "Contact",
    title: "Say hello",
    subtitle: "Reach the people who run Terrakin, report a bug, or report a security problem.",
  },
};

/** The static card in packages/client/public, for anything that can't be drawn. */
const FALLBACK_CARD = "/og.png";

export type CardRoute =
  | { kind: "site" }
  | { kind: "page"; slug: string }
  | { kind: "profile"; id: string }
  | { kind: "post"; id: string };

/** The card a path asks for, or undefined when it isn't a card path. */
export function matchCardPath(pathname: string): CardRoute | undefined {
  if (pathname === "/og/site.png") return { kind: "site" };
  const m = /^\/og\/(page|profile|post)\/([A-Za-z0-9_-]{1,64})\.png$/.exec(pathname);
  if (!m?.[1] || !m[2]) return undefined;
  const id = m[2];
  if (m[1] === "page") return id in PAGE_CARDS ? { kind: "page", slug: id } : undefined;
  return m[1] === "profile" ? { kind: "profile", id } : { kind: "post", id };
}

/**
 * A card before its pictures are loaded: avatars and photos are media ids, so the key can be
 * computed (and the cache checked) without touching storage.
 */
type CardSpec =
  | { kind: "site" }
  | PageCard
  | (Omit<ProfileCard, "person"> & { person: SpecPerson })
  | (Omit<PostCard, "author" | "image"> & { author: SpecPerson; image?: string | undefined });
type SpecPerson = Omit<ProfileCard["person"], "avatar"> & { avatar?: string | undefined };

function profileSpec(r: ProfileView): CardSpec {
  return {
    kind: "profile",
    person: {
      name: r.name,
      kind: r.kind,
      color: r.color,
      shape: r.shape,
      avatar: mediaId(r.avatar),
      townsfolk: r.townsfolk === true,
      xHandle: r.x?.handle,
    },
    bio: r.bio || r.note,
    posts: r.posts,
    followers: r.followers,
    following: r.following,
  };
}

function postSpec(p: PostView): CardSpec {
  const photo = p.media.find((m) => m.kind === "image");
  return {
    kind: "post",
    author: {
      name: p.author.name,
      kind: p.author.kind,
      color: p.author.color,
      shape: p.author.shape,
      avatar: mediaId(p.author.avatar),
      townsfolk: p.author.townsfolk === true,
    },
    text: p.text,
    image: mediaId(photo?.url),
    likes: p.likeCount,
    replies: p.replyCount,
    date: p.createdAt,
    reply: p.replyTo !== null,
  };
}

/** A short hash of what a card shows and the template version. Changes when the card would. */
async function cardKey(spec: CardSpec): Promise<string> {
  const data = new TextEncoder().encode(`${CARDS_VERSION}:${JSON.stringify(spec)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A card's path under /og/. */
function cardPath(route: CardRoute): string {
  switch (route.kind) {
    case "site":
      return "/og/site.png";
    case "page":
      return `/og/page/${route.slug}.png`;
    case "profile":
      return `/og/profile/${encodeURIComponent(route.id)}.png`;
    case "post":
      return `/og/post/${encodeURIComponent(route.id)}.png`;
  }
}

/**
 * The card for a loaded page, as the absolute versioned URL and alt text the meta tags use.
 * Missing pages get the site card.
 */
export async function pageImage(loaded: Loaded): Promise<PageImage> {
  let route: CardRoute = { kind: "site" };
  let spec: CardSpec = { kind: "site" };
  let alt = "Terrakin, a small world you build together";
  if ("profile" in loaded) {
    route = { kind: "profile", id: loaded.profile.id };
    spec = profileSpec(loaded.profile);
    alt = `${loaded.profile.name} on Terrakin: their profile card`;
  } else if ("post" in loaded) {
    route = { kind: "post", id: loaded.post.id };
    spec = postSpec(loaded.post);
    alt = `A post by ${loaded.post.author.name} on Terrakin`;
  } else {
    const slug = loaded.page.name === "site" ? loaded.page.slug : loaded.page.name;
    const page = "missing" in loaded ? undefined : PAGE_CARDS[slug];
    if (page) {
      route = { kind: "page", slug };
      spec = { kind: "page", ...page };
      alt = `Terrakin: ${page.title}`;
    }
  }
  return { url: `${SITE_ORIGIN}${cardPath(route)}?v=${await cardKey(spec)}`, alt };
}

/** What the card route needs from its runtime. */
export interface CardDeps {
  get: ApiGet;
  /** An upload's bytes by media id, or undefined. */
  loadMedia(id: string): Promise<Uint8Array | undefined>;
  render(card: Card): Promise<Rendered>;
  /** Cached PNGs by key. The Worker uses the Cache API; Node a small map. */
  cache: {
    get(key: string): Promise<Uint8Array | undefined>;
    put(key: string, png: Uint8Array): Promise<void> | void;
  };
  /** Whether this client may cause another render right now (cache misses per IP per minute). */
  allowRender(ip: string): boolean;
}

export interface CardRequest {
  route: CardRoute;
  /** The `v` query parameter, if any. */
  version: string | null;
  ifNoneMatch: string | null;
  ip: string;
}

export interface CardResponse {
  status: 200 | 302 | 304;
  headers: Record<string, string>;
  body?: Uint8Array;
}

const YEAR = "public, max-age=31536000, immutable";
/** An unversioned card can change (likes, a new bio), so caches keep it ten minutes. */
const LIVE = "public, max-age=600";

const redirect = (cacheControl: string): CardResponse => ({
  status: 302,
  headers: { location: FALLBACK_CARD, "cache-control": cacheControl },
});

/** Answer a card request: from cache when possible, rendering at most once per change. */
export async function serveCard(req: CardRequest, deps: CardDeps): Promise<CardResponse> {
  const spec = await specFor(req.route, deps.get);
  // Unknown ids get the static card for a few minutes; a failed lookup isn't cached at all.
  if (spec === "missing") return redirect("public, max-age=300");
  if (spec === "unavailable") return redirect("no-store");
  const key = await cardKey(spec);
  const etag = `"${key}"`;
  const headers = {
    "content-type": "image/png",
    "cache-control": req.version === key ? YEAR : LIVE,
    etag,
    "x-content-type-options": "nosniff",
  };
  if (req.ifNoneMatch?.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
    return { status: 304, headers };
  }
  const cacheKey = `${req.route.kind}/${key}`;
  const hit = await deps.cache.get(cacheKey);
  if (hit) return { status: 200, headers, body: hit };
  // Each miss costs about 100 ms of CPU, so one client can only cause a few a minute.
  if (!deps.allowRender(req.ip)) return redirect("no-store");
  try {
    const card = await materialize(spec, deps.loadMedia);
    const { bytes } = await deps.render(card);
    await deps.cache.put(cacheKey, bytes);
    return { status: 200, headers, body: bytes };
  } catch (err) {
    console.error("card render failed", req.route.kind, err);
    return redirect("no-store");
  }
}

async function specFor(
  route: CardRoute,
  get: ApiGet,
): Promise<CardSpec | "missing" | "unavailable"> {
  if (route.kind === "site") return { kind: "site" };
  if (route.kind === "page") {
    const page = PAGE_CARDS[route.slug];
    return page ? { kind: "page", ...page } : "missing";
  }
  const path =
    route.kind === "profile"
      ? `/v1/residents/${encodeURIComponent(route.id)}`
      : `/v1/posts/${encodeURIComponent(route.id)}`;
  try {
    const { status, body } = await get(path);
    if (status === 404) return "missing";
    if (status !== 200) return "unavailable";
    return route.kind === "profile"
      ? profileSpec((body as { resident: ProfileView }).resident)
      : postSpec((body as { post: PostView }).post);
  } catch {
    return "unavailable";
  }
}

/** Load a spec's pictures. One that's missing or can't be drawn leaves the card without it. */
async function materialize(spec: CardSpec, loadMedia: CardDeps["loadMedia"]): Promise<Card> {
  const picture = async (id: string | undefined) => {
    if (!id) return undefined;
    const bytes = await loadMedia(id).catch(() => undefined);
    return bytes ? imageDataUri(bytes) : undefined;
  };
  if (spec.kind === "profile") {
    return { ...spec, person: { ...spec.person, avatar: await picture(spec.person.avatar) } };
  }
  if (spec.kind === "post") {
    const [avatar, image] = await Promise.all([picture(spec.author.avatar), picture(spec.image)]);
    return { ...spec, author: { ...spec.author, avatar }, image };
  }
  return spec;
}

/**
 * A fixed-window counter per key (an IP, or an IPv6 /64). It lives in one process or isolate, so
 * on Cloudflare it's a speed bump per isolate, not a global wall; the cache does the real work.
 */
export function windowLimiter(limit: number, windowMs: number, now = () => Date.now()) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string): boolean => {
    const t = now();
    if (hits.size > 5_000) for (const [k, v] of hits) if (v.until <= t) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.until <= t) {
      hits.set(key, { n: 1, until: t + windowMs });
      return true;
    }
    h.n++;
    return h.n <= limit;
  };
}

/** Card renders one client may cause per minute. */
export const RENDERS_PER_MINUTE = 12;
