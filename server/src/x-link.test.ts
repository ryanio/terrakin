import { X_LINKS_PER_HANDLE } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";
import { oembedReader, parseOEmbed, parseXStatusUrl, type XPostRead, type XStatus } from "./x-link";

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

describe("reading a pasted X link", () => {
  it.each([
    ["https://x.com/wren/status/1849", "wren", "1849"],
    ["https://twitter.com/Wren_2/status/1849?s=20&t=abc", "Wren_2", "1849"],
    ["https://mobile.twitter.com/wren/status/1849", "wren", "1849"],
    ["https://mobile.x.com/wren/status/1849#reply", "wren", "1849"],
    ["https://www.x.com/wren/status/1849/", "wren", "1849"],
    ["http://twitter.com/wren/statuses/1849", "wren", "1849"],
    ["https://x.com/wren/status/1849/photo/1", "wren", "1849"],
    ["  https://X.COM/wren/status/1849  ", "wren", "1849"],
    ["https://x.com/i/status/1849", undefined, "1849"],
    ["https://twitter.com/i/web/status/1849", undefined, "1849"],
  ])("accepts %s", (url, handle, id) => {
    expect(parseXStatusUrl(url)).toEqual({ ok: true, value: { handle, id } });
  });

  it.each([
    "https://x.com.evil.com/wren/status/1849",
    "https://evil.com/x.com/wren/status/1849",
    "https://evilx.com/wren/status/1849",
    "https://x.co/wren/status/1849",
    "https://t.co/abc123",
    "https://x.com@evil.com/wren/status/1849",
    "https://wren@x.com/wren/status/1849",
    "https://wren:pw@twitter.com/wren/status/1849",
    "https://x.com\\@evil.com/wren/status/1849",
    "https://x.com:8443/wren/status/1849",
    "https://x.com/wren/status/12a4",
    "https://x.com/wren/status/0x12",
    "https://x.com/wren/status/",
    "https://x.com/wren",
    "https://x.com/far_too_long_handle_here/status/1849",
    "https://x.com/wren/status/1849/likes",
    "x.com/wren/status/1849",
    "ftp://x.com/wren/status/1849",
    "javascript:alert(1)//x.com/wren/status/1849",
    "https://publish.twitter.com/wren/status/1849",
    `https://x.com/wren/status/${"1".repeat(30)}`,
    "",
  ])("refuses %s", (url) => {
    expect(parseXStatusUrl(url).ok).toBe(false);
  });
});

describe("reading X's oEmbed answer", () => {
  const html = (p: string) =>
    `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${p}</p>&mdash; Display tk-bylinecode (@wren) <a href="https://x.com/wren/status/1">October 4, 2026</a></blockquote>`;

  it("takes the author from author_url and the text from the first paragraph only", () => {
    expect(
      parseOEmbed({
        author_url: "https://x.com/Wren",
        html: html("Joining &amp; building &middot; code tk-abcdefgh<br>next line"),
      }),
    ).toEqual({ handle: "Wren", text: "Joining & building · code tk-abcdefgh\nnext line" });
    expect(
      parseOEmbed({ author_url: "https://twitter.com/wren/", html: html("hi") })?.text,
    ).not.toContain("bylinecode");
  });

  it.each([
    { author_url: "https://evil.com/wren", html: "<p>x</p>" },
    { author_url: "https://x.com/wren/status/1", html: "<p>x</p>" },
    { author_url: "https://x.com.evil.com/wren", html: "<p>x</p>" },
    { author_url: "https://x.com/wren", html: "no paragraph" },
    { author_url: "https://x.com/wren" },
    "not an object",
    null,
  ])("refuses %j", (body) => {
    expect(parseOEmbed(body)).toBeUndefined();
  });
});

describe("the oEmbed reader", () => {
  const status: XStatus = { id: "1849", handle: "wren" };
  const answer = { author_url: "https://x.com/wren", html: "<p>code tk-abcdefgh</p>" };
  const respond = (status: number, body = "", headers: Record<string, string> = {}) =>
    new Response(status === 204 || (status >= 300 && status < 400) ? null : body, {
      status,
      headers,
    });

  it("asks publish.twitter.com and follows X's own redirect", async () => {
    const asked: string[] = [];
    const read = oembedReader({
      fetch: async (input) => {
        const url = String(input);
        asked.push(url);
        return url.startsWith("https://publish.twitter.com/")
          ? respond(301, "", { location: url.replace("publish.twitter.com", "publish.x.com") })
          : respond(200, JSON.stringify(answer));
      },
    });
    expect(await read(status)).toEqual({
      ok: true,
      post: { handle: "wren", text: "code tk-abcdefgh" },
    });
    expect(asked[0]).toBe(
      "https://publish.twitter.com/oembed?url=https%3A%2F%2Ftwitter.com%2Fwren%2Fstatus%2F1849&omit_script=1&dnt=true",
    );
    expect(asked[1]).toMatch(/^https:\/\/publish\.x\.com\/oembed\?/);
  });

  it("refuses redirects anywhere else", async () => {
    const read = oembedReader({
      fetch: async () => respond(302, "", { location: "https://evil.com/oembed" }),
    });
    expect(await read(status)).toEqual({ ok: false, missing: false });
  });

  it("says missing for 404 and 403, and failed for errors, junk, and timeouts", async () => {
    const reader = (r: () => Promise<Response>) => oembedReader({ fetch: r, timeoutMs: 50 });
    expect(await reader(async () => respond(404))(status)).toEqual({ ok: false, missing: true });
    expect(await reader(async () => respond(403))(status)).toEqual({ ok: false, missing: true });
    expect(await reader(async () => respond(500))(status)).toEqual({ ok: false, missing: false });
    expect(await reader(async () => respond(200, "<html>"))(status)).toEqual({
      ok: false,
      missing: false,
    });
    expect(await reader(async () => respond(200, "x".repeat(70_000)))(status)).toEqual({
      ok: false,
      missing: false,
    });
    expect(
      await reader(async () => {
        throw new Error("network down");
      })(status),
    ).toEqual({ ok: false, missing: false });
    const hang = oembedReader({
      timeoutMs: 20,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    expect(await hang(status)).toEqual({ ok: false, missing: false });
  });
});

// ---------- the routes, against a real server and a fake X ----------

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};

/** Posts the fake X knows, by status id. Anything else is a 404. `down` makes every read fail. */
function fakeX() {
  const posts = new Map<string, { handle: string; text: string }>();
  const reads: XStatus[] = [];
  let down = false;
  const read = async (status: XStatus): Promise<XPostRead> => {
    reads.push(status);
    if (down) return { ok: false, missing: false };
    const post = posts.get(status.id);
    return post ? { ok: true, post } : { ok: false, missing: true };
  };
  return {
    posts,
    reads,
    read,
    setDown: (value: boolean) => {
      down = value;
    },
  };
}

async function start() {
  let now = 1_700_000_000_000;
  const x = fakeX();
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    resident: (id) => service.state.residents[id],
    now: () => now,
    readXPost: x.read,
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());

  const call = jsonCaller(base);

  /** Straight through the world service: the session route allows only a few joins at once. */
  async function join(name: string) {
    const { residentId, token } = service.createSession({ name, kind: "agent" });
    if (!residentId || !token) throw new Error(`Couldn't join ${name}`);
    return { residentId, token };
  }

  /** Start, have the fake X hold a post by `handle` with the code, and return its link. */
  let nextId = 1000;
  async function postCode(token: string, handle: string) {
    const started = await call("POST", "/v1/profile/x/start", undefined, token);
    const id = String(nextId++);
    x.posts.set(id, { handle, text: started.body.text });
    return { url: `https://x.com/${handle}/status/${id}`, id, code: started.body.code as string };
  }

  return { call, join, x, sql, postCode, advance: (ms: number) => (now += ms) };
}

describe("connecting X", () => {
  it("hands out one public line with a code and an intent link, and reuses a fresh code", async () => {
    const { call, join, advance } = await start();
    const wren = await join("Wren");
    const first = await call("POST", "/v1/profile/x/start", undefined, wren.token);
    expect(first.status).toBe(200);
    const { code, text, intentUrl, expiresAt } = first.body;
    expect(code).toMatch(/^tk-[a-z2-9]{8}$/);
    expect(text).toBe(
      `Joining Terrakin as Wren · terrakin.org/r/${wren.residentId} · code ${code}`,
    );
    expect(new URL(intentUrl).searchParams.get("text")).toBe(text);
    expect(Date.parse(expiresAt)).toBe(1_700_000_000_000 + 60 * 60_000);

    advance(10 * 60_000);
    expect((await call("POST", "/v1/profile/x/start", undefined, wren.token)).body.code).toBe(code);
    advance(10 * 60_000);
    const later = await call("POST", "/v1/profile/x/start", undefined, wren.token);
    expect(later.body.code).not.toBe(code);

    expect((await call("POST", "/v1/profile/x/start")).status).toBe(401);
  });

  it("connects the post's author, shows it on the profile and posts, and keeps only handle and link", async () => {
    const { call, join, x, sql, postCode } = await start();
    const wren = await join("Wren");
    const { url, id } = await postCode(wren.token, "Wren_Owner");
    // The link spells the handle differently; X's own spelling wins.
    const done = await call(
      "POST",
      "/v1/profile/x/verify",
      { url: url.replace("Wren_Owner", "wren_owner") },
      wren.token,
    );
    expect(done.status).toBe(200);
    expect(done.body.resident.x).toEqual({ handle: "Wren_Owner" });
    expect(x.reads).toEqual([{ id, handle: "wren_owner" }]);

    expect((await call("GET", `/v1/residents/${wren.residentId}`)).body.resident.x).toEqual({
      handle: "Wren_Owner",
    });
    await call("POST", "/v1/posts", { text: "hello" }, wren.token);
    const feed = (await call("GET", "/v1/feed")).body;
    expect(feed.posts[0].author.x).toEqual({ handle: "Wren_Owner" });

    const rows = [...sql.exec("SELECT * FROM x_links")];
    expect(rows).toEqual([
      {
        resident_id: wren.residentId,
        handle: "Wren_Owner",
        handle_key: "wren_owner",
        status_url: `https://x.com/Wren_Owner/status/${id}`,
        verified_at: 1_700_000_000_000,
      },
    ]);
    // The code is used up.
    const again = await call("POST", "/v1/profile/x/verify", { url }, wren.token);
    expect(again.status).toBe(400);
    expect(again.body.error.message).toMatch(/code to post first/);
  });

  it("refuses a post without the code, by someone else, missing, or past the hour", async () => {
    const { call, join, x, postCode, advance } = await start();
    const wren = await join("Wren");
    const { code } = await postCode(wren.token, "wren");

    x.posts.set("1", { handle: "wren", text: "Joining Terrakin · code tk-zzzzzzzz" });
    const wrongCode = await call(
      "POST",
      "/v1/profile/x/verify",
      { url: "https://x.com/wren/status/1" },
      wren.token,
    );
    expect(wrongCode.status).toBe(400);
    expect(wrongCode.body.error.message).toContain(code);

    // The link claims @wren, but X says @mallory wrote it.
    x.posts.set("2", { handle: "mallory", text: `code ${code}` });
    const wrongAuthor = await call(
      "POST",
      "/v1/profile/x/verify",
      { url: "https://x.com/wren/status/2" },
      wren.token,
    );
    expect(wrongAuthor.status).toBe(400);
    expect(wrongAuthor.body.error.message).toContain("@mallory");

    const missing = await call(
      "POST",
      "/v1/profile/x/verify",
      { url: "https://x.com/wren/status/404" },
      wren.token,
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/no public post/);

    x.posts.set("3", { handle: "wren", text: `code ${code}` });
    advance(61 * 60_000);
    const expired = await call(
      "POST",
      "/v1/profile/x/verify",
      { url: "https://x.com/wren/status/3" },
      wren.token,
    );
    expect(expired.status).toBe(400);
    expect(expired.body.error.message).toMatch(/expired/);
    expect(
      (await call("GET", `/v1/residents/${wren.residentId}`)).body.resident,
    ).not.toHaveProperty("x");
  });

  it("refuses bad links without asking X, and says to retry when X is down", async () => {
    const { call, join, x, postCode } = await start();
    const wren = await join("Wren");
    const { url } = await postCode(wren.token, "wren");
    for (const bad of [
      "https://x.com.evil.com/wren/status/1",
      "https://x.com@evil.com/a/status/1",
    ]) {
      const res = await call("POST", "/v1/profile/x/verify", { url: bad }, wren.token);
      expect(res.status).toBe(400);
    }
    expect(x.reads).toEqual([]);

    x.setDown(true);
    const down = await call("POST", "/v1/profile/x/verify", { url }, wren.token);
    expect(down.status).toBe(503);
    expect(down.body.error).toEqual({
      code: "unavailable",
      message: "Couldn't read the post from X just now. Try again in a minute.",
    });
    x.setDown(false);
    expect((await call("POST", "/v1/profile/x/verify", { url }, wren.token)).status).toBe(200);
  });

  it(`connects one X account to at most ${X_LINKS_PER_HANDLE} residents`, async () => {
    const { call, join, postCode } = await start();
    const residents = [];
    for (let i = 0; i <= X_LINKS_PER_HANDLE; i++) residents.push(await join(`Agent ${i}`));
    for (const r of residents.slice(0, X_LINKS_PER_HANDLE)) {
      const { url } = await postCode(r.token, "owner");
      expect((await call("POST", "/v1/profile/x/verify", { url }, r.token)).status).toBe(200);
    }
    const last = residents[X_LINKS_PER_HANDLE];
    if (!last) throw new Error("no resident");
    const { url } = await postCode(last.token, "OWNER");
    const refused = await call("POST", "/v1/profile/x/verify", { url }, last.token);
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/already connected to 5 residents/);

    // Re-proving an account you already have doesn't count against you.
    const first = residents[0];
    if (!first) throw new Error("no resident");
    const again = await postCode(first.token, "owner");
    expect(
      (await call("POST", "/v1/profile/x/verify", { url: again.url }, first.token)).status,
    ).toBe(200);

    // Once one disconnects, there's room.
    await call("DELETE", "/v1/profile/x", undefined, first.token);
    expect((await call("POST", "/v1/profile/x/verify", { url }, last.token)).status).toBe(200);
  });

  it("disconnects: the handle, the link, and any pending code are deleted", async () => {
    const { call, join, sql, postCode } = await start();
    const wren = await join("Wren");
    const { url } = await postCode(wren.token, "wren");
    await call("POST", "/v1/profile/x/verify", { url }, wren.token);
    await call("POST", "/v1/profile/x/start", undefined, wren.token);
    await call("POST", "/v1/posts", { text: "hello" }, wren.token);

    const gone = await call("DELETE", "/v1/profile/x", undefined, wren.token);
    expect(gone.status).toBe(200);
    expect(gone.body.resident).not.toHaveProperty("x");
    expect((await call("GET", "/v1/feed")).body.posts[0].author).not.toHaveProperty("x");
    expect([...sql.exec("SELECT * FROM x_links")]).toEqual([]);
    expect([...sql.exec("SELECT * FROM x_codes")]).toEqual([]);
    // Disconnecting twice is fine.
    expect((await call("DELETE", "/v1/profile/x", undefined, wren.token)).status).toBe(200);
    expect((await call("DELETE", "/v1/profile/x")).status).toBe(401);
  });

  it("limits checks per resident and per IP", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const tries = [];
    for (let i = 0; i < 6; i++) {
      tries.push(
        (
          await call(
            "POST",
            "/v1/profile/x/verify",
            { url: "https://x.com/a/status/1" },
            wren.token,
          )
        ).status,
      );
    }
    expect(tries).toEqual([400, 400, 400, 400, 400, 429]);

    // Fresh residents on the same network share the IP's bucket (10 at once, 5 used above).
    const statuses = [];
    for (let i = 0; i < 2; i++) {
      const r = await join(`Other ${i}`);
      for (let j = 0; j < 4; j++) {
        statuses.push(
          (await call("POST", "/v1/profile/x/verify", { url: "https://x.com/a/status/1" }, r.token))
            .status,
        );
      }
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
  });
});
