import type { AddressInfo } from "node:net";
import type { ServerMessage } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  Api,
  ipKey,
  type LiveSocket,
  MAX_WATCHERS,
  MAX_WATCHERS_PER_NETWORK,
  WATCH_MAX_MS,
  WATCH_SILENT_MS,
} from "./api";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/** `post` messages on `/v1/live`: who gets them, who doesn't, and the `watch` greeting. */

const CONFIG: WorldConfig = {
  width: 40,
  height: 40,
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

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start(caps: { maxWatchers?: number; maxWatchersPerNetwork?: number } = {}) {
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    resident: (id: string) => service.state.residents[id],
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    ...caps,
  });
  await new Promise<void>((done) => server.listen(0, done));
  cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
  cleanups.push(() => sql.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, body?: unknown, token?: string) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const isJson = res.headers.get("content-type")?.includes("json");
    return { status: res.status, body: (isJson && text ? JSON.parse(text) : {}) as Json };
  }

  function join(name: string) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  }

  /** A socket that sends `first` on open and keeps every message. `ready` waits for `until`, an error, or a close. */
  function socket(first: unknown, until: ServerMessage["type"]) {
    const ws = new WebSocket(`${base.replace("http", "ws")}/v1/live`);
    const messages: ServerMessage[] = [];
    let closed: number | undefined;
    cleanups.push(() => ws.close());
    const ready = new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString()) as ServerMessage;
        messages.push(m);
        if (m.type === until || m.type === "error") resolve();
      });
      ws.on("close", (code) => {
        closed = code;
        resolve();
      });
    });
    ws.once("open", () => ws.send(JSON.stringify(first)));
    return {
      ws,
      messages,
      ready,
      closed: () => closed,
      posts: () => messages.filter((m) => m.type === "post"),
    };
  }
  const watch = (token?: string, following?: boolean) =>
    socket(
      { type: "watch", v: 1, ...(token ? { token } : {}), ...(following ? { following } : {}) },
      "watching",
    );
  const hello = (token: string, posts?: boolean) =>
    socket({ type: "hello", v: 1, token, ...(posts ? { posts } : {}) }, "welcome");

  const post = async (token: string, body: Json) => {
    const res = await call("POST", "/v1/posts", body, token);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.post as Json;
  };

  /** Ping each socket and wait for the pong, so anything sent before it has arrived. */
  const settle = async (...sockets: ReturnType<typeof socket>[]) => {
    for (const s of sockets) s.ws.send(JSON.stringify({ type: "ping", id: "settle" }));
    for (const s of sockets) {
      await expect.poll(() => s.messages.some((m) => m.type === "pong")).toBe(true);
    }
  };
  const ids = (s: ReturnType<typeof socket>) =>
    s.posts().map((m) => (m.type === "post" ? m.id : ""));

  return { call, join, watch, hello, post, service, settle, ids };
}

describe("post messages on /v1/live", () => {
  it("tells watchers and world sockets that asked about a new post, by id only", async () => {
    const { join, watch, hello, post, service, settle } = await start();
    const ash = join("Ash");
    const wren = join("Wren");
    const moss = join("Moss");
    const visitor = watch();
    const signedIn = watch(wren.token);
    const inWorld = hello(wren.token, true);
    // A world socket that didn't ask for posts doesn't get them.
    const quiet = hello(moss.token);
    await Promise.all([visitor.ready, signedIn.ready, inWorld.ready, quiet.ready]);
    expect(visitor.messages).toEqual([{ type: "watching" }]);

    // Watching isn't being in the world: it changes nobody's presence.
    const anon = watch();
    await anon.ready;
    const online = service.onlineCount();

    const made = await post(ash.token, { text: "First light over the lake" });
    const expected = {
      type: "post",
      id: made.id,
      authorId: ash.id,
      createdAt: made.createdAt,
    };
    for (const s of [visitor, signedIn, inWorld, anon]) {
      await expect.poll(() => s.posts()).toEqual([expected]);
    }
    // No resident text rides along.
    expect(JSON.stringify(visitor.messages)).not.toContain("First light");
    expect(service.onlineCount()).toBe(online);
    await settle(quiet);
    expect(quiet.posts()).toEqual([]);
  });

  it("pushes a post made through an action link", async () => {
    const { call, join, watch } = await start();
    const ash = join("Ash");
    const visitor = watch();
    await visitor.ready;
    const { body } = await call("POST", "/v1/link-key", undefined, ash.token);
    const text = encodeURIComponent("Posted from a link");
    const res = await call("GET", `/v1/act/${body.key}/post?text=${text}`);
    expect(res.status).toBe(200);
    await expect.poll(() => visitor.posts()).toHaveLength(1);
    expect(visitor.posts()[0]).toMatchObject({ type: "post", authorId: ash.id });
  });

  it("sends nothing for replies, and nothing across a block either way", async () => {
    const { call, join, watch, hello, post, settle, ids } = await start();
    const ash = join("Ash");
    const blocker = join("Blocker");
    const blocked = join("Blocked");
    const bystander = join("Bystander");
    expect(
      (await call("PUT", `/v1/residents/${ash.id}/block`, undefined, blocker.token)).status,
    ).toBe(200);
    expect(
      (await call("PUT", `/v1/residents/${blocked.id}/block`, undefined, ash.token)).status,
    ).toBe(200);
    const sockets = {
      blocker: watch(blocker.token),
      blocked: watch(blocked.token),
      bystander: watch(bystander.token),
      blockerInWorld: hello(blocker.token, true),
      blockedInWorld: hello(blocked.token, true),
    };
    await Promise.all(Object.values(sockets).map((s) => s.ready));

    const top = await post(ash.token, { text: "A top-level post" });
    await post(ash.token, { text: "A reply", replyTo: top.id });
    const quote = await post(bystander.token, { text: "Quoting", quote: top.id });
    await settle(...Object.values(sockets));

    expect(ids(sockets.bystander)).toEqual([top.id, quote.id]);
    expect(ids(sockets.blocker)).toEqual([quote.id]);
    expect(ids(sockets.blocked)).toEqual([quote.id]);
    expect(ids(sockets.blockerInWorld)).toEqual([quote.id]);
    expect(ids(sockets.blockedInWorld)).toEqual([quote.id]);
  });

  it("on the following feed, sends only posts by people you follow and your own", async () => {
    const { call, join, watch, post, settle, ids } = await start();
    const ash = join("Ash");
    const moss = join("Moss");
    const wren = join("Wren");
    expect(
      (await call("PUT", `/v1/residents/${ash.id}/follow`, undefined, wren.token)).status,
    ).toBe(200);
    const following = watch(wren.token, true);
    const everyone = watch(wren.token);
    await Promise.all([following.ready, everyone.ready]);

    const fromAsh = await post(ash.token, { text: "From someone Wren follows" });
    const fromMoss = await post(moss.token, { text: "From someone Wren doesn't" });
    const own = await post(wren.token, { text: "Wren's own" });
    await settle(following, everyone);
    expect(ids(following)).toEqual([fromAsh.id, own.id]);
    expect(ids(everyone)).toEqual([fromAsh.id, fromMoss.id, own.id]);

    // The following feed is yours, so it needs a token.
    const anon = watch(undefined, true);
    await anon.ready;
    expect(anon.messages[0]).toMatchObject({ type: "error", error: { code: "bad_request" } });
  });

  it("ends a watch when the owner revokes its token", async () => {
    const { join, watch, service } = await start();
    const agent = join("Agent");
    const s = watch(agent.token);
    await s.ready;
    service.revokeTokens(agent.id);
    await expect.poll(() => s.closed()).toBe(4003);
    expect(s.messages.at(-1)).toMatchObject({ type: "error", error: { code: "unauthorized" } });
  });

  it("only watches: no actions, no hello on the same socket, and a bad token is refused", async () => {
    const { join, watch } = await start();
    const wren = join("Wren");
    const s = watch(wren.token);
    await s.ready;
    s.ws.send(JSON.stringify({ type: "action", id: "a1", action: { type: "move", dx: 1, dy: 0 } }));
    s.ws.send(JSON.stringify({ type: "hello", v: 1, token: wren.token }));
    await expect.poll(() => s.messages.filter((m) => m.type === "error").length).toBe(2);
    expect(s.messages.some((m) => m.type === "welcome" || m.type === "ack")).toBe(false);

    const bad = watch("not-a-token");
    await bad.ready;
    expect(bad.messages[0]).toMatchObject({ type: "error", error: { code: "unauthorized" } });
  });

  it("caps how many sockets one network can hold open watching", async () => {
    expect(MAX_WATCHERS_PER_NETWORK).toBeGreaterThanOrEqual(50);
    const { watch } = await start({ maxWatchersPerNetwork: 3 });
    const open = Array.from({ length: 3 }, () => watch());
    await Promise.all(open.map((s) => s.ready));
    expect(open.every((s) => s.messages[0]?.type === "watching")).toBe(true);

    const extra = watch();
    await extra.ready;
    expect(extra.messages[0]).toMatchObject({
      type: "error",
      error: { code: "rate_limited", message: expect.stringContaining("your network") },
    });
    await expect.poll(() => extra.closed()).toBe(4029);

    // Closing one frees its place.
    open[0]?.ws.close();
    await expect.poll(() => open[0]?.closed()).toBeDefined();
    const again = watch();
    await again.ready;
    expect(again.messages[0]).toEqual({ type: "watching" });
  });

  it("caps how many sockets can watch at once in all", async () => {
    expect(MAX_WATCHERS).toBeGreaterThan(MAX_WATCHERS_PER_NETWORK);
    const { watch } = await start({ maxWatchers: 2 });
    const open = [watch(), watch()];
    await Promise.all(open.map((s) => s.ready));
    const extra = watch();
    await extra.ready;
    expect(extra.messages[0]).toMatchObject({
      type: "error",
      error: { code: "rate_limited", message: expect.stringContaining("Lots of people") },
    });
    await expect.poll(() => extra.closed()).toBe(4029);
  });

  it("counts IPv6 watchers by /48", () => {
    expect(ipKey("2001:db8:1:2:aaaa::1", 3)).toBe("2001:db8:1::/48");
    expect(ipKey("2001:db8:1:ffff::9", 3)).toBe("2001:db8:1::/48");
    expect(ipKey("203.0.113.7", 3)).toBe("203.0.113.7");
  });
});

describe("watch sockets over time", () => {
  /** An Api with a clock the test moves, and sockets that record what they're sent. */
  function setup() {
    let now = 1_700_000_000_000;
    const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
    const api = new Api({ service, skill: "", openapi: "", now: () => now });
    const open = (ip = "203.0.113.7") => {
      const sent: Json[] = [];
      let closed: number | undefined;
      const socket: LiveSocket = {
        send: (text) => sent.push(JSON.parse(text)),
        close: (code) => {
          closed ??= code;
        },
      };
      const session = api.live(ip, socket);
      session.onMessage(JSON.stringify({ type: "watch", v: 1 }));
      expect(sent[0]).toEqual({ type: "watching" });
      return { session, sent, closed: () => closed };
    };
    return { api, open, advance: (ms: number) => (now += ms) };
  }

  it("drops a watch socket that goes quiet, and keeps one that pings", () => {
    const { api, open, advance } = setup();
    const pinging = open();
    const silent = open();
    for (let t = 0; t < WATCH_SILENT_MS + 60_000; t += 45_000) {
      advance(45_000);
      pinging.session.onMessage(JSON.stringify({ type: "ping", id: "p" }));
      api.sweep();
    }
    expect(silent.closed()).toBe(4009);
    expect(pinging.closed()).toBeUndefined();
  });

  it("ends every watch socket after its lifetime, and frees its place", () => {
    const { api, open, advance } = setup();
    const s = open();
    for (let t = 0; t < WATCH_MAX_MS; t += 45_000) {
      advance(45_000);
      s.session.onMessage(JSON.stringify({ type: "ping", id: "p" }));
      api.sweep();
    }
    expect(s.closed()).toBe(4008);
    // Closed from the server's side, so it no longer counts against the network.
    const again = Array.from({ length: MAX_WATCHERS_PER_NETWORK }, () => open());
    expect(again.every((w) => w.closed() === undefined)).toBe(true);
  });
});
