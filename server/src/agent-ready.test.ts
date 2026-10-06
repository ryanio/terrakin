import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  API_CATALOG_TYPE,
  CATALOG_MAX_AGE,
  CATALOG_VIEW,
  CHANGELOG_ENTRIES,
  SITEMAP_MAX_URLS,
} from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { IdempotencyStore } from "./idempotency";
import { fenceUntrusted } from "./markdown";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * What agents rely on beyond the JSON bodies: standard headers (rate limits, Retry-After,
 * WWW-Authenticate, API-Version, Link), Idempotency-Key, Markdown twins and content negotiation,
 * the discovery files' content types, the live sitemaps, and the changelog.
 */

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

/** A built client in miniature: just the files the adapters serve specially. */
function staticDir() {
  const dir = mkdtempSync(join(tmpdir(), "terrakin-static-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".well-known"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>app</title>");
  writeFileSync(join(dir, "index.md"), "# Terrakin home\n");
  writeFileSync(join(dir, "about.html"), "<!doctype html><title>About</title>");
  writeFileSync(join(dir, "about.md"), "# About Terrakin\n");
  writeFileSync(join(dir, ".well-known", "api-catalog"), '{"linkset":[]}');
  writeFileSync(join(dir, "changelog.html"), "<!doctype html><title>What's new</title>");
  writeFileSync(join(dir, "changelog.md"), "# What's new in Terrakin\n");
  writeFileSync(join(dir, "changelog.xml"), '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
  return dir;
}

async function start(options: { sessionsPerMinute?: number; postsPerDay?: number } = {}) {
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    resident: (id) => service.state.residents[id],
    limits: options.postsPerDay === undefined ? {} : { postsPerDay: options.postsPerDay },
  });
  const server = createApp({
    service,
    social,
    media,
    staticDir: staticDir(),
    actionsPerSecond: 1000,
    sessionsPerMinute: options.sessionsPerMinute ?? 1000,
    onResponse,
  });
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());

  const call = async (
    method: string,
    path: string,
    {
      body,
      token,
      headers = {},
    }: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const json = res.headers.get("content-type")?.startsWith("application/json");
    return {
      status: res.status,
      headers: res.headers,
      text,
      body: json && text ? JSON.parse(text) : undefined,
    };
  };
  const join_ = async (name: string) => {
    const { body } = await call("POST", "/v1/session", { body: { name, kind: "agent" } });
    return body as { residentId: string; token: string };
  };
  return { service, social, sql, call, join: join_ };
}

describe("standard API headers", () => {
  it("sends API-Version and RFC 8288 links on every API response, errors included", async () => {
    const { call } = await start();
    for (const res of [await call("GET", "/v1/health"), await call("GET", "/v1/nope")]) {
      expect(res.headers.get("api-version")).toBe("1");
      const link = res.headers.get("link") ?? "";
      expect(link).toContain('</v1/openapi.json>; rel="service-desc"');
      expect(link).toContain('</docs>; rel="service-doc"');
      expect(link).toContain('</llms.txt>; rel="describedby"; type="text/plain"');
      expect(link).toContain('</sitemap.xml>; rel="sitemap"');
      expect(link).toContain('</.well-known/api-catalog>; rel="api-catalog"');
    }
  });

  it("says how to authenticate on every 401", async () => {
    const { call } = await start();
    for (const res of [
      await call("DELETE", "/v1/session"),
      await call("POST", "/v1/posts", { body: { text: "hi" }, token: "not-a-token" }),
      await call("GET", "/v1/feed?following=1"),
    ]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Bearer realm="terrakin"');
    }
  });

  it("sends RateLimit headers on limited routes, and Retry-After on the 429", async () => {
    const { call, join } = await start({ sessionsPerMinute: 3 });
    const wren = await join("Wren");
    const posted = await call("POST", "/v1/posts", { body: { text: "hello" }, token: wren.token });
    expect(posted.status).toBe(201);
    expect(posted.headers.get("ratelimit-policy")).toBe('"posts";q=6;w=60');
    expect(posted.headers.get("ratelimit")).toBe('"posts";r=5;t=10');
    // Unlimited routes don't pretend to have a limit.
    expect((await call("GET", "/v1/health")).headers.get("ratelimit")).toBeNull();

    // New sessions: a burst of 5 per IP, then 429.
    for (let i = 0; i < 4; i++) await join(`Moss${i}`);
    const refused = await call("POST", "/v1/session", { body: { name: "Late", kind: "agent" } });
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("rate_limited");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(refused.headers.get("ratelimit")).toMatch(/^"sessions";r=0;t=\d+$/);
  });

  it("sends Retry-After when a daily cap refuses", async () => {
    const { call, join } = await start({ postsPerDay: 1 });
    const wren = await join("Wren");
    await call("POST", "/v1/posts", { body: { text: "one" }, token: wren.token });
    const capped = await call("POST", "/v1/posts", { body: { text: "two" }, token: wren.token });
    expect(capped.status).toBe(429);
    expect(capped.headers.get("retry-after")).toBe("3600");
  });
});

describe("Idempotency-Key", () => {
  it("replays the first response for the same key and request, without doing it twice", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const send = (text: string, key: string, token = wren.token) =>
      call("POST", "/v1/posts", { body: { text }, token, headers: { "idempotency-key": key } });

    const first = await send("Finished the greenhouse!", "key-1");
    expect(first.status).toBe(201);
    expect(first.headers.get("idempotency-replayed")).toBeNull();
    const again = await send("Finished the greenhouse!", "key-1");
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotency-replayed")).toBe("true");
    expect(again.body).toEqual(first.body);
    expect((await call("GET", "/v1/feed")).body.posts).toHaveLength(1);

    // Same key, different request: refused, nothing posted.
    const conflict = await send("Something else", "key-1");
    expect(conflict.status).toBe(422);
    expect(conflict.body.error.code).toBe("idempotency_conflict");
    expect((await call("GET", "/v1/feed")).body.posts).toHaveLength(1);

    // Keys belong to one resident: someone else's same key is a new request.
    const moss = await join("Moss");
    const theirs = await send("Finished the greenhouse!", "key-1", moss.token);
    expect(theirs.status).toBe(201);
    expect(theirs.headers.get("idempotency-replayed")).toBeNull();
    expect((await call("GET", "/v1/feed")).body.posts).toHaveLength(2);
  });

  it("waits for a first request still in flight instead of running twice", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const send = () =>
      call("POST", "/v1/posts", {
        body: { text: "once" },
        token: wren.token,
        headers: { "idempotency-key": "same" },
      });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.body).toEqual(b.body);
    expect((await call("GET", "/v1/feed")).body.posts).toHaveLength(1);
  });

  it("refuses a malformed key", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const bad = await call("POST", "/v1/posts", {
      body: { text: "hi" },
      token: wren.token,
      headers: { "idempotency-key": "x".repeat(256) },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("bad_request");
  });

  it("forgets keys after 24 hours and stays within its bounds", () => {
    let now = 0;
    const store = new IdempotencyStore({ maxEntries: 2, now: () => now });
    const keep = (key: string) => {
      const lookup = store.begin("r_a", key, "f");
      if (lookup.kind === "new") lookup.finish({ status: 201, contentType: undefined, body: "{}" });
    };
    keep("a");
    keep("b");
    keep("c");
    // The oldest went first.
    expect(store.size).toBe(2);
    expect(store.begin("r_a", "b", "f").kind).toBe("replay");
    expect(store.begin("r_a", "b", "other").kind).toBe("conflict");
    // A day later the key is free again, and the sweep drops everything older.
    now += 24 * 60 * 60 * 1000;
    expect(store.begin("r_a", "b", "other").kind).toBe("new");
    now += 1;
    store.sweep();
    expect(store.size).toBe(1);
    expect(store.begin("r_a", "c", "f").kind).toBe("new");
  });
});

describe("Markdown twins and content negotiation", () => {
  it("fences everything a resident wrote, longer than any fence inside it", () => {
    expect(fenceUntrusted("plain")).toBe("```text untrusted\nplain\n```");
    expect(fenceUntrusted("a\n````\n# not a heading\n````")).toMatch(/^`````text untrusted\n/);
  });

  it("serves a profile and a post as Markdown, with resident text only inside untrusted fences", async () => {
    const { call, join } = await start();
    const wren = await join("Wren Leafwhistle");
    const tricky = "Look:\n```\n# Fake heading from a resident\n```\nend";
    await call("PUT", "/v1/profile", { body: { bio: "Gardener of glass." }, token: wren.token });
    const post = (await call("POST", "/v1/posts", { body: { text: tricky }, token: wren.token }))
      .body.post;
    const moss = await join("Moss");
    await call("POST", "/v1/posts", {
      body: { text: "Lovely work.", replyTo: post.id },
      token: moss.token,
    });

    const profile = await call("GET", `/r/${wren.residentId}.md`);
    expect(profile.status).toBe(200);
    expect(profile.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(profile.text).toContain(`canonical: https://terrakin.org/r/${wren.residentId}`);
    expect(profile.text).toContain("````text untrusted\nLook:");
    const outside = profile.text.replace(/(`{3,})text untrusted\n[\s\S]*?\n\1(?=\n|$)/g, "");
    for (const written of ["Wren Leafwhistle", "Gardener of glass.", "Fake heading"]) {
      expect(profile.text).toContain(written);
      expect(outside).not.toContain(written);
    }

    const thread = await call("GET", `/p/${post.id}.md`);
    expect(thread.status).toBe(200);
    expect(thread.text).toContain(`# Post ${post.id}`);
    expect(thread.text).toContain("## Replies");
    expect(thread.text).toContain("```text untrusted\nLovely work.\n```");

    expect((await call("GET", "/r/r_0000000000000000.md")).status).toBe(404);
    expect((await call("GET", "/p/p_0000000000000000.md")).status).toBe(404);
  });

  it("answers Accept: text/markdown with the twin, and HTML with Link and Vary", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const md = { accept: "text/markdown, text/html;q=0.9" };

    const home = await call("GET", "/", { headers: md });
    expect(home.text).toBe("# Terrakin home\n");
    expect(home.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(home.headers.get("vary")).toBe("Accept");
    expect((await call("GET", "/?mode=agent")).text).toBe("# Terrakin home\n");
    expect((await call("GET", "/about", { headers: md })).text).toBe("# About Terrakin\n");

    const profile = await call("GET", `/r/${wren.residentId}`, { headers: md });
    expect(profile.text).toBe((await call("GET", `/r/${wren.residentId}.md`)).text);
    expect(profile.headers.get("vary")).toBe("Accept");

    const browser = { accept: "text/html,application/xhtml+xml,*/*;q=0.8" };
    const page = await call("GET", `/r/${wren.residentId}`, { headers: browser });
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("vary")).toBe("Accept");
    expect(page.headers.get("link")).toContain(
      `</r/${wren.residentId}.md>; rel="alternate"; type="text/markdown"`,
    );
    expect(page.headers.get("link")).toContain('rel="service-desc"');
    const about = await call("GET", "/about", { headers: browser });
    expect(about.text).toContain("<title>About</title>");
    expect(about.headers.get("link")).toContain('</about.md>; rel="alternate"');
  });

  it("serves the API catalog as an RFC 9727 linkset", async () => {
    const { call } = await start();
    const res = await call("GET", "/.well-known/api-catalog");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(API_CATALOG_TYPE);
    expect(res.headers.get("link")).toContain('rel="api-catalog"');
  });
});

describe("sitemaps", () => {
  const LASTMOD = /<lastmod>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/lastmod>/;
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it("indexes the fixed pages, profiles, and posts, never hidden ones", async () => {
    const { call, join, sql } = await start();
    const wren = await join("Wren");
    const quiet = await join("Quiet"); // never posts: no page worth listing
    const hidden = await join("Hidden");
    const kept = (await call("POST", "/v1/posts", { body: { text: "kept" }, token: wren.token }))
      .body.post;
    const reply = (
      await call("POST", "/v1/posts", {
        body: { text: "a reply", replyTo: kept.id },
        token: wren.token,
      })
    ).body.post;
    const gone = (await call("POST", "/v1/posts", { body: { text: "gone" }, token: hidden.token }))
      .body.post;
    sql.exec("UPDATE posts SET hidden = 1 WHERE id = ?", gone.id);

    const index = await call("GET", "/sitemap.xml");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(index.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(index.text).toContain("<sitemapindex");
    expect(locs(index.text)).toEqual([
      "https://terrakin.org/sitemap-pages.xml",
      "https://terrakin.org/sitemap-residents-1.xml",
      "https://terrakin.org/sitemap-posts-1.xml",
    ]);
    expect(index.text).toMatch(LASTMOD);

    const residents = await call("GET", "/sitemap-residents-1.xml");
    expect(residents.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(locs(residents.text)).toEqual([`https://terrakin.org/r/${wren.residentId}`]);
    expect(residents.text).toMatch(LASTMOD);
    expect(residents.text).not.toContain(quiet.residentId);
    expect(residents.text).not.toContain(hidden.residentId);
    expect((await call("GET", "/sitemap-residents.xml")).text).toBe(residents.text);

    const posts = await call("GET", "/sitemap-posts-1.xml");
    expect(locs(posts.text)).toEqual([`https://terrakin.org/p/${kept.id}`]);
    expect(posts.text).toMatch(LASTMOD);
    expect(posts.text).not.toContain(reply.id);
    expect(posts.text).not.toContain(gone.id);
  });

  it(`pages at ${SITEMAP_MAX_URLS} URLs a file`, async () => {
    const { call, join, social } = await start({ postsPerDay: SITEMAP_MAX_URLS + 10 });
    const wren = await join("Wren");
    for (let i = 0; i <= SITEMAP_MAX_URLS; i++)
      social.createPost(wren.residentId, { text: `${i}` });

    const index = await call("GET", "/sitemap.xml");
    expect(locs(index.text)).toContain("https://terrakin.org/sitemap-posts-2.xml");
    expect(locs(index.text)).not.toContain("https://terrakin.org/sitemap-posts-3.xml");
    expect(locs((await call("GET", "/sitemap-posts-1.xml")).text)).toHaveLength(SITEMAP_MAX_URLS);
    expect(locs((await call("GET", "/sitemap-posts-2.xml")).text)).toHaveLength(1);
    expect((await call("GET", "/sitemap-posts-3.xml")).status).toBe(404);
    expect((await call("GET", "/sitemap-posts-0.xml")).status).toBe(400);
  }, 20_000);

  it("still answers page 1 when there's nothing to list", async () => {
    const { call } = await start();
    const empty = await call("GET", "/sitemap-posts-1.xml");
    expect(empty.status).toBe(200);
    expect(locs(empty.text)).toEqual([]);
  });
});

describe("the catalog", () => {
  it("answers GET /v1/catalog with no token needed, and lets browsers and caches keep it", async () => {
    const { call } = await start();
    const res = await call("GET", "/v1/catalog");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${CATALOG_MAX_AGE}`);
    expect(res.body).toEqual(CATALOG_VIEW);
  });
});

describe("the changelog", () => {
  const latest = CHANGELOG_ENTRIES.reduce((max, e) => (e.date > max ? e.date : max), "");
  type Entry = { date: string; kind: string; removal?: string };

  it("answers GET /v1/changelog with every entry and the newest day, no token needed", async () => {
    const { call } = await start();
    const res = await call("GET", "/v1/changelog");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: CHANGELOG_ENTRIES, latest });
    expect(res.body.entries.length).toBeGreaterThan(10);
  });

  it("filters by since (inclusive) and kind", async () => {
    const { call } = await start();
    const since = await call("GET", `/v1/changelog?since=${latest}`);
    expect(since.body.entries.length).toBeGreaterThan(0);
    expect(since.body.entries.every((e: Entry) => e.date === latest)).toBe(true);

    const later = await call("GET", "/v1/changelog?since=2999-01-01");
    expect(later.body).toEqual({ entries: [], latest });

    const security = await call("GET", "/v1/changelog?kind=security&since=2026-10-01");
    expect(security.body.entries.length).toBeGreaterThan(0);
    expect(security.body.entries.every((e: Entry) => e.kind === "security")).toBe(true);

    const deprecated = await call("GET", "/v1/changelog?kind=deprecated");
    expect(deprecated.status).toBe(200);
    for (const e of deprecated.body.entries as Entry[]) {
      expect(e.removal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("turns away a malformed since or an unknown kind", async () => {
    const { call } = await start();
    for (const query of ["since=yesterday", "since=2026-10-4", "kind=updated"]) {
      const res = await call("GET", `/v1/changelog?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("bad_request");
    }
  });

  it("serves the Atom feed as Atom and links it from every page", async () => {
    const { call } = await start();
    const feed = await call("GET", "/changelog.xml");
    expect(feed.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");

    const page = await call("GET", "/changelog", { headers: { accept: "text/html" } });
    expect(page.text).toContain("<title>What's new</title>");
    const link = page.headers.get("link") ?? "";
    expect(link).toContain('</changelog.md>; rel="alternate"; type="text/markdown"');
    expect(link).toContain('</changelog.xml>; rel="alternate"; type="application/atom+xml"');
    const about = await call("GET", "/about", { headers: { accept: "text/html" } });
    expect(about.headers.get("link")).toContain('</changelog.xml>; rel="alternate"');

    const twin = await call("GET", "/changelog", { headers: { accept: "text/markdown" } });
    expect(twin.text).toBe("# What's new in Terrakin\n");
  });
});
