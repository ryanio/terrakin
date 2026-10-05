import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PostView, ProfileView } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { type Rewriter, type RewriterElement, rewriteDocument } from "../cloudflare/meta-rewriter";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { applyEdits } from "./meta-html";
import { nodeSql } from "./node-sql";
import { type CardDeps, matchCardPath, pageImage, serveCard, windowLimiter } from "./og";
import {
  type DocumentEdits,
  type Loaded,
  loadPage,
  META_SELECTORS,
  matchPage,
  noscriptParts,
  pageEdits,
  scriptJson,
} from "./page-meta";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

const INDEX_HTML = readFileSync(new URL("../../client/index.html", import.meta.url), "utf8");
const HOSTILE = '"><script>alert(1)</script>';

const profile = (over: Partial<ProfileView> = {}): ProfileView => ({
  id: "r_0123456789abcdef",
  trust: "untrusted",
  name: "Juniper",
  kind: "human",
  color: "leaf",
  shape: "round",
  note: "",
  bio: "Gardener and slow builder.",
  avatar: null,
  online: false,
  posts: 3,
  followers: 12,
  following: 4,
  followed: false,
  ...over,
});

const post = (over: Partial<PostView> = {}): PostView => ({
  id: "p_0123456789abcdef",
  trust: "untrusted",
  author: {
    id: "r_0123456789abcdef",
    name: "Juniper",
    kind: "human",
    color: "leaf",
    shape: "round",
    avatar: null,
  },
  text: "Finished the greenhouse! Took three evenings and a lot of glass.",
  media: [],
  replyTo: null,
  replyCount: 2,
  likeCount: 5,
  liked: false,
  createdAt: "2026-10-04T09:30:00.000Z",
  ...over,
});

async function editsFor(loaded: Loaded): Promise<DocumentEdits> {
  const edits = pageEdits(loaded, await pageImage(loaded));
  if (!edits) throw new Error("no edits");
  return edits;
}

const attr = (html: string, selector: string, name = "content") => {
  const [, tag, key, value] = /^(\w+)\[(\w+)="([^"]+)"\]$/.exec(selector) ?? [];
  const m = new RegExp(`<${tag}\\b[^>]*\\b${key}="${value}"[^>]*>`).exec(html);
  return m ? new RegExp(`\\b${name}="([^"]*)"`).exec(m[0])?.[1] : undefined;
};

describe("page meta", () => {
  it("matches the same pages as the client router", () => {
    expect(matchPage("/")).toEqual({ name: "home" });
    expect(matchPage("/world/")).toEqual({ name: "world" });
    expect(matchPage("/town")).toEqual({ name: "town" });
    expect(matchPage("/shop")).toEqual({ name: "shop" });
    expect(matchPage("/r/r_0123456789abcdef/3d")).toEqual({
      name: "profile",
      id: "r_0123456789abcdef",
    });
    expect(matchPage("/gallery/3d")).toEqual({ name: "world" });
    expect(matchPage("/r/r_abc")).toEqual({ name: "profile", id: "r_abc" });
    expect(matchPage("/p/p_abc/")).toEqual({ name: "post", id: "p_abc" });
    expect(matchPage("/r/a.b")).toEqual({ name: "not-found" });
    expect(matchPage("/nope")).toEqual({ name: "not-found" });
  });

  it("only sets tags that exist in client/index.html", () => {
    for (const selector of Object.values(META_SELECTORS)) {
      expect(
        attr(INDEX_HTML, selector, selector.startsWith("link") ? "href" : "content"),
        selector,
      ).not.toBeUndefined();
    }
    expect(INDEX_HTML).toContain("</noscript>");
  });

  it("gives a profile its title, canonical URL, card and ProfilePage JSON-LD", async () => {
    const r = profile({ avatar: "/media/m_00112233445566aa" });
    const html = applyEdits(
      INDEX_HTML,
      await editsFor({ page: { name: "profile", id: r.id }, profile: r, posts: [post()] }),
    );
    expect(html).toContain("<title>Juniper on Terrakin</title>");
    expect(attr(html, META_SELECTORS.canonical, "href")).toBe(
      "https://terrakin.org/r/r_0123456789abcdef",
    );
    expect(attr(html, META_SELECTORS.ogType)).toBe("profile");
    expect(attr(html, META_SELECTORS.ogImage)).toMatch(
      /^https:\/\/terrakin\.org\/og\/profile\/r_0123456789abcdef\.png\?v=[0-9a-f]{16}$/,
    );
    expect(attr(html, META_SELECTORS.twitterImage)).toBe(attr(html, META_SELECTORS.ogImage));
    expect(attr(html, META_SELECTORS.robots)).toMatch(/^index/);
    const ld = JSON.parse(
      /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? "",
    );
    expect(ld["@type"]).toBe("ProfilePage");
    expect(ld.mainEntity).toMatchObject({
      "@type": "Person",
      name: "Juniper",
      image: "https://terrakin.org/media/m_00112233445566aa",
    });
    expect(html).toContain('<a href="/p/p_0123456789abcdef">');
  });

  it("gives a post an article card, a quoted title and DiscussionForumPosting JSON-LD", async () => {
    const p = post({
      media: [
        {
          id: "m_00112233445566bb",
          kind: "image",
          type: "image/png",
          url: "/media/m_00112233445566bb",
          bytes: 10,
        },
      ],
    });
    const edits = await editsFor({ page: { name: "post", id: p.id }, post: p, replies: [] });
    const html = applyEdits(INDEX_HTML, edits);
    expect(html).toMatch(
      /<title>Juniper on Terrakin: "Finished the greenhouse! Took three [^<]*…"<\/title>/,
    );
    expect(attr(html, META_SELECTORS.ogType)).toBe("article");
    expect(attr(html, META_SELECTORS.ogImage)).toMatch(/\/og\/post\/p_0123456789abcdef\.png\?v=/);
    const ld = JSON.parse(typeof edits.jsonLd === "object" ? edits.jsonLd.set : "");
    expect(ld).toMatchObject({
      "@type": "DiscussionForumPosting",
      datePublished: "2026-10-04T09:30:00.000Z",
      author: { name: "Juniper", url: "https://terrakin.org/r/r_0123456789abcdef" },
      image: "https://terrakin.org/media/m_00112233445566bb",
      commentCount: 2,
    });
    expect(ld.interactionStatistic[0]).toMatchObject({ userInteractionCount: 5 });
  });

  it("marks unknown ids and paths noindex with the site card and no canonical", async () => {
    for (const loaded of [
      { page: { name: "profile" as const, id: "r_nope" }, missing: true as const },
      { page: { name: "not-found" as const } },
    ]) {
      const edits = await editsFor(loaded);
      expect(edits.status).toBe(404);
      const html = applyEdits(INDEX_HTML, edits);
      expect(attr(html, META_SELECTORS.robots)).toBe("noindex");
      expect(html).not.toContain('rel="canonical"');
      expect(attr(html, META_SELECTORS.ogImage)).toMatch(/\/og\/site\.png\?v=/);
    }
  });

  it("swaps the homepage's JSON-LD for the page's own, or drops it", async () => {
    const built = INDEX_HTML.replace(
      "</head>",
      '<script type="application/ld+json">{"@type":"FAQPage"}</script>\n</head>',
    );
    const home = applyEdits(built, await editsFor({ page: { name: "home" } }));
    expect(home).toContain('{"@type":"FAQPage"}');
    const world = applyEdits(built, await editsFor({ page: { name: "world" } }));
    expect(world).not.toContain("application/ld+json");
    expect(attr(world, META_SELECTORS.ogImage)).toMatch(/\/og\/page\/world\.png\?v=/);
    const town = applyEdits(built, await editsFor({ page: { name: "town" } }));
    expect(town).toContain("<title>Town Hall · Terrakin</title>");
    expect(attr(town, META_SELECTORS.ogImage)).toMatch(/\/og\/page\/town\.png\?v=/);
    const p = post();
    const one = applyEdits(
      built,
      await editsFor({ page: { name: "post", id: p.id }, post: p, replies: [] }),
    );
    expect(one).not.toContain("FAQPage");
    expect(one.match(/application\/ld\+json/g)).toHaveLength(1);
  });

  it("keeps letters, invites, and claims out of search, with no canonical URL", async () => {
    for (const path of ["/letters", "/letters/r_abc", "/i/k7Qx2", "/claim/abcd-efgh-jkmn-pqrs"]) {
      const page = matchPage(path);
      expect(page.name, path).toBe("private");
      const edits = await editsFor(
        await loadPage(page, async () => ({ status: 500, body: undefined })),
      );
      expect(edits.status).toBe(200);
      const html = applyEdits(INDEX_HTML, edits);
      expect(attr(html, META_SELECTORS.robots)).toBe("noindex");
      expect(html).not.toContain('rel="canonical"');
    }
  });

  it("keeps notifications out of search too", async () => {
    const page = matchPage("/notifications");
    expect(page).toEqual({ name: "private", what: "notifications" });
    const html = applyEdits(
      INDEX_HTML,
      await editsFor(await loadPage(page, async () => ({ status: 500, body: undefined }))),
    );
    expect(attr(html, META_SELECTORS.robots)).toBe("noindex");
    expect(html).toContain("<title>Notifications · Terrakin</title>");
  });

  it("serves /u/handle as the profile it names, with /r/<id> as the canonical URL", async () => {
    const page = matchPage("/u/Wren_2");
    expect(page).toEqual({ name: "handle", handle: "Wren_2" });
    expect(matchPage("/u/ab")).toEqual({ name: "not-found" });
    expect(matchPage("/@Wren_2")).toEqual({ name: "not-found" });
    const r = profile({ handle: "wren_2" });
    const asked: string[] = [];
    const loaded = await loadPage(page, async (path) => {
      asked.push(path);
      if (path.startsWith("/v1/residents/by-handle/"))
        return { status: 200, body: { resident: r } };
      if (path.endsWith("/posts?limit=10")) return { status: 200, body: { posts: [] } };
      return { status: 200, body: { resident: r } };
    });
    expect(asked[0]).toBe("/v1/residents/by-handle/Wren_2");
    expect(loaded).toMatchObject({ page: { name: "profile", id: r.id } });
    const html = applyEdits(INDEX_HTML, await editsFor(loaded));
    expect(attr(html, META_SELECTORS.canonical, "href")).toMatch(new RegExp(`/r/${r.id}$`));

    const missing = await loadPage(matchPage("/u/nobody"), async () => ({
      status: 404,
      body: undefined,
    }));
    expect((await editsFor(missing)).status).toBe(404);
  });

  it("gives pages with their own file only their card", async () => {
    const page = matchPage("/docs");
    expect(page).toEqual({ name: "site", path: "/docs", slug: "docs" });
    expect(matchPage("/about")).toMatchObject({ name: "site", slug: "about" });
    const loaded = await loadPage(page, async () => {
      throw new Error("not called");
    });
    const edits = await editsFor(loaded);
    expect(edits.title).toBeUndefined();
    expect(edits.jsonLd).toBe("keep");
    expect(edits.attributes.map((a) => a.selector)).toEqual([
      META_SELECTORS.ogImage,
      META_SELECTORS.ogImageAlt,
      META_SELECTORS.twitterImage,
      META_SELECTORS.twitterImageAlt,
    ]);
    expect(edits.attributes[0]?.value).toMatch(/\/og\/page\/docs\.png\?v=/);
  });

  it("leaves index.html alone when the API doesn't answer", async () => {
    const loaded = await loadPage({ name: "post", id: "p_x" }, async () => {
      throw new Error("down");
    });
    expect(pageEdits(loaded, await pageImage(loaded))).toBeUndefined();
  });

  it("escapes hostile names and posts in every place they land (Node)", async () => {
    const r = profile({ name: HOSTILE, bio: `</noscript>${HOSTILE} & more` });
    const html = applyEdits(
      INDEX_HTML,
      await editsFor({
        page: { name: "profile", id: r.id },
        profile: r,
        posts: [post({ text: `</script>${HOSTILE}` })],
      }),
    );
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("</noscript><script");
    expect(html).toContain('<title>"&gt;&lt;script&gt;alert(1)&lt;/script&gt; on Terrakin</title>');
    expect(attr(html, META_SELECTORS.ogTitle)).toBe(
      "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; on Terrakin",
    );
    // The page's own scripts plus the JSON-LD: nothing else opened a script.
    expect(html.match(/<script/g)?.length).toBe((INDEX_HTML.match(/<script/g)?.length ?? 0) + 1);
  });

  it("makes JSON-LD that can't close its script", () => {
    const json = scriptJson({ a: "</script><!-- & \u2028" });
    expect(json).not.toMatch(/[<>&\u2028]/);
    expect(JSON.parse(json)).toEqual({ a: "</script><!-- & \u2028" });
  });

  it("keeps every resident-written string a text run in the noscript copy", () => {
    const parts = noscriptParts([
      { tag: "h1", text: HOSTILE },
      { tag: "ul", items: [[{ tag: "a", text: HOSTILE, href: '/r/x"y' }]] },
    ]);
    const markup = parts.flatMap((p) => ("markup" in p ? [p.markup] : [])).join("");
    expect(markup).not.toContain("<script");
    expect(markup).toContain('href="/r/x&quot;y"');
    expect(parts.filter((p) => "text" in p && p.text === HOSTILE)).toHaveLength(2);
  });

  it("gives HTMLRewriter untrusted text only through its escaping APIs (Worker)", async () => {
    const r = profile({ name: HOSTILE, bio: HOSTILE });
    const edits = await editsFor({
      page: { name: "profile", id: r.id },
      profile: r,
      posts: [post({ text: HOSTILE })],
    });
    const raw: string[] = [];
    const escaped: string[] = [];
    const el: RewriterElement = {
      setAttribute: (_n, v) => escaped.push(v),
      setInnerContent: (c, o) => (o?.html ? raw : escaped).push(c),
      append: (c, o) => (o?.html ? raw : escaped).push(c),
      remove: () => undefined,
      onEndTag: (handler) => handler({ before: (c, o) => (o?.html ? raw : escaped).push(c) }),
    };
    const handlers: { element(e: RewriterElement): void }[] = [];
    const fake: Rewriter = {
      on: (_selector, h) => {
        handlers.push(h);
        return fake;
      },
    };
    rewriteDocument(fake, edits);
    for (const h of handlers) h.element(el);
    expect(raw.join("")).not.toContain("<script>alert");
    expect(escaped.filter((s) => s.includes(HOSTILE)).length).toBeGreaterThan(3);
  });
});

describe("card route", () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const deps = (over: Partial<CardDeps> = {}) => {
    const stored = new Map<string, Uint8Array>();
    let renders = 0;
    const d: CardDeps = {
      get: async (path) =>
        path.startsWith("/v1/residents/r_known")
          ? { status: 200, body: { resident: profile({ id: "r_known" }) } }
          : { status: 404, body: undefined },
      loadMedia: async () => undefined,
      render: async () => {
        renders++;
        return { bytes: png, type: "image/png", width: 1200, height: 630 };
      },
      cache: { get: async (k) => stored.get(k), put: (k, v) => void stored.set(k, v) },
      allowRender: () => true,
      ...over,
    };
    return { d, renders: () => renders };
  };
  const req = (path: string, extra: { version?: string; ifNoneMatch?: string } = {}) => {
    const route = matchCardPath(path);
    if (!route) throw new Error(`not a card path: ${path}`);
    return {
      route,
      version: extra.version ?? null,
      ifNoneMatch: extra.ifNoneMatch ?? null,
      ip: "1.2.3.4",
    };
  };

  it("knows its paths and nothing else", () => {
    expect(matchCardPath("/og/site.png")).toEqual({ kind: "site" });
    expect(matchCardPath("/og/page/world.png")).toEqual({ kind: "page", slug: "world" });
    expect(matchCardPath("/og/page/anything.png")).toBeUndefined();
    expect(matchCardPath("/og/profile/r_1.png")).toEqual({ kind: "profile", id: "r_1" });
    expect(matchCardPath("/og/post/../x.png")).toBeUndefined();
    expect(matchCardPath("/og.png")).toBeUndefined();
  });

  it("renders once, then serves from cache with an ETag; a matching version is immutable", async () => {
    const { d, renders } = deps();
    const first = await serveCard(req("/og/profile/r_known.png"), d);
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("public, max-age=600");
    const etag = first.headers.etag ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    const versioned = await serveCard(
      req("/og/profile/r_known.png", { version: etag.slice(1, -1) }),
      d,
    );
    expect(versioned.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(versioned.body).toEqual(png);
    expect(renders()).toBe(1);
    const again = await serveCard(req("/og/profile/r_known.png", { ifNoneMatch: etag }), d);
    expect(again.status).toBe(304);
  });

  it("sends unknown ids, failures and over-limit misses to the static card", async () => {
    const missing = await serveCard(req("/og/profile/r_nope.png"), deps().d);
    expect(missing).toMatchObject({ status: 302, headers: { location: "/og.png" } });
    const limited = deps({ allowRender: () => false });
    const capped = await serveCard(req("/og/profile/r_known.png"), limited.d);
    expect(capped).toMatchObject({ status: 302, headers: { "cache-control": "no-store" } });
    expect(limited.renders()).toBe(0);
    const broken = await serveCard(
      req("/og/site.png"),
      deps({
        render: async () => {
          throw new Error("boom");
        },
      }).d,
    );
    expect(broken).toMatchObject({ status: 302, headers: { "cache-control": "no-store" } });
  });

  it("caps renders per client per minute", () => {
    let now = 0;
    const allow = windowLimiter(3, 60_000, () => now);
    expect([1, 2, 3, 4].map(() => allow("a"))).toEqual([true, true, true, false]);
    expect(allow("b")).toBe(true);
    now = 60_000;
    expect(allow("a")).toBe(true);
  });
});

describe("Node server", () => {
  const CONFIG: WorldConfig = {
    width: 12,
    height: 12,
    plotSize: 4,
    maxPlotsPerResident: 1,
    reach: 2,
  };
  const cleanups: (() => void | Promise<void>)[] = [];
  const { problems, onResponse } = responseChecker();
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
    expect(problems.splice(0)).toEqual([]);
  });

  async function start() {
    const dir = mkdtempSync(join(tmpdir(), "terrakin-seo-"));
    writeFileSync(join(dir, "index.html"), INDEX_HTML);
    const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
    const sql = nodeSql();
    const media = new MemoryMediaStore();
    const social = new SocialService({ sql, media, resident: (id) => service.state.residents[id] });
    const server = createApp({ service, social, media, staticDir: dir, onResponse });
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const base = await listenOnFreePort(server, cleanups);
    cleanups.push(() => sql.close());
    const session = (await (
      await fetch(`${base}/v1/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: '"><b>Wren</b>', kind: "agent" }),
      })
    ).json()) as { residentId: string; token: string };
    const created = (await (
      await fetch(`${base}/v1/posts`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ text: "Hello </noscript><script>alert(1)</script> neighbors" }),
      })
    ).json()) as { post: { id: string } };
    return { base, resident: session.residentId, postId: created.post.id };
  }

  it("serves pages with their meta, and 404 with noindex for unknown ones", async () => {
    const { base, resident, postId } = await start();
    const profileRes = await fetch(`${base}/r/${resident}`);
    expect(profileRes.status).toBe(200);
    const html = await profileRes.text();
    expect(html).toContain('<title>"&gt;&lt;b&gt;Wren&lt;/b&gt; on Terrakin</title>');
    expect(html).toContain(`/og/profile/${resident}.png?v=`);
    const postHtml = await (await fetch(`${base}/p/${postId}`)).text();
    expect(postHtml).toContain('<meta property="og:type" content="article"');
    expect(postHtml).not.toContain("</noscript><script>alert");
    const missing = await fetch(`${base}/p/p_0000000000000000`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('<meta name="robots" content="noindex"');
  });

  it("serves cards with cache headers", async () => {
    const { base, resident } = await start();
    const res = await fetch(`${base}/og/profile/${resident}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{16}"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new DataView(bytes.buffer).getUint32(16)).toBe(1200);
    const unknown = await fetch(`${base}/og/post/p_0000000000000000.png`, { redirect: "manual" });
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get("location")).toBe("/og.png");
  }, 30_000);
});
