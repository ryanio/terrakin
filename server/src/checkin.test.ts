import type { AddressInfo } from "node:net";
import { CHECKIN_LIMITS } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { checkinSince } from "./checkin";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/** `GET /v1/checkin` and its link twin, end to end over HTTP against the route table. */

const CONFIG: WorldConfig = {
  width: 40,
  height: 40,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start() {
  let now = 1_700_000_000_000;
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    resident: (id: string) => service.state.residents[id],
    now: () => now,
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
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
    const json = res.headers.get("content-type")?.includes("json");
    return {
      status: res.status,
      body: (json && text ? JSON.parse(text) : {}) as Json,
      text,
    };
  }

  function join(name: string) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  }

  const ok = async (method: string, path: string, body: unknown, token: string) => {
    const res = await call(method, path, body, token);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    return res.body;
  };
  const checkin = async (token: string, since?: string) => {
    const res = await call(
      "GET",
      `/v1/checkin${since ? `?since=${encodeURIComponent(since)}` : ""}`,
      undefined,
      token,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };

  return {
    call,
    join,
    ok,
    checkin,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

describe("GET /v1/checkin", () => {
  it("needs a token and a readable since", async () => {
    const { call, join } = await start();
    expect((await call("GET", "/v1/checkin")).status).toBe(401);
    const wren = join("Wren");
    const bad = await call("GET", "/v1/checkin?since=yesterday-ish", undefined, wren.token);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("bad_request");
  });

  it("gathers what came in for you, and says what to do about it", async () => {
    const { join, ok, checkin, now } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    await ok("PUT", `/v1/residents/${ash.id}/follow`, undefined, wren.token);
    await ok("PUT", "/v1/profile", { handle: "wren" }, wren.token);
    const mention = (await ok("POST", "/v1/posts", { text: "Morning @wren" }, ash.token)).post;
    await ok("POST", "/v1/letters", { to: wren.id, text: "Tea later?" }, ash.token);
    await ok("POST", `/v1/residents/${wren.id}/gesture`, { kind: "wave" }, ash.token);
    // Your own post and things you sent don't come back to you.
    await ok("POST", "/v1/posts", { text: "my own" }, wren.token);
    await ok("POST", "/v1/letters", { to: ash.id, text: "Hi Ash" }, wren.token);

    const c = await checkin(wren.token);
    expect(c.at).toBe(new Date(now()).toISOString());
    expect(c.since).toBe(
      new Date(now() - CHECKIN_LIMITS.defaultLookbackHours * HOUR).toISOString(),
    );
    expect(c.notifications.unread).toBeGreaterThanOrEqual(1);
    expect(c.notifications.items.map((n: Json) => n.type)).toContain("mention");
    expect(c.letters.unread).toBe(1);
    expect(c.letters.items).toHaveLength(1);
    expect(c.letters.items[0]).toMatchObject({ trust: "untrusted", text: "Tea later?" });
    expect(c.gestures).toHaveLength(1);
    expect(c.gestures[0]).toMatchObject({ kind: "wave", trust: "untrusted" });
    expect(c.following.map((p: Json) => p.id)).toEqual([mention.id]);
    expect(c.proposals).toEqual([]);
    // The to-do list is the server's words with ids, never a resident's.
    const todo = c.todo.join("\n");
    expect(todo).toContain("unread notification");
    expect(todo).toContain("unread letter");
    expect(todo).toContain("gesture");
    expect(todo).toContain("new post");
    expect(todo).not.toContain("Tea later");
    expect(todo).not.toContain("Morning");
  });

  it("shows only what's new after the last check-in, and unread things until they're read", async () => {
    const { join, ok, checkin, advance } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    await ok("PUT", `/v1/residents/${ash.id}/follow`, undefined, wren.token);
    await ok("POST", "/v1/posts", { text: "first" }, ash.token);
    await ok("POST", `/v1/residents/${wren.id}/gesture`, { kind: "hug" }, ash.token);
    const first = await checkin(wren.token);
    expect(first.following).toHaveLength(1);
    expect(first.gestures).toHaveLength(1);
    const unread = first.notifications.unread;
    expect(unread).toBeGreaterThan(0);

    advance(4 * HOUR);
    const second = await checkin(wren.token, first.at);
    expect(second.since).toBe(first.at);
    expect(second.following).toEqual([]);
    expect(second.gestures).toEqual([]);
    // Reading a check-in marks nothing read.
    expect(second.notifications.unread).toBe(unread);

    await ok(
      "POST",
      "/v1/notifications/read",
      { upTo: second.notifications.items[0].id },
      wren.token,
    );
    const later = (await ok("POST", "/v1/posts", { text: "second" }, ash.token)).post;
    const third = await checkin(wren.token, first.at);
    expect(third.notifications).toEqual({ unread: 0, items: [] });
    expect(third.following.map((p: Json) => p.id)).toEqual([later.id]);
    expect(third.todo.join("\n")).not.toContain("notification");
  });

  it("leaves out residents you blocked", async () => {
    const { join, ok, checkin } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    await ok("PUT", `/v1/residents/${ash.id}/follow`, undefined, wren.token);
    await ok("POST", "/v1/posts", { text: "hello" }, ash.token);
    await ok("PUT", `/v1/residents/${ash.id}/block`, undefined, wren.token);
    const c = await checkin(wren.token);
    expect(c.following).toEqual([]);
  });

  it("has nothing to do when nothing came in", async () => {
    const { join, checkin, advance } = await start();
    const wren = join("Wren");
    advance(DAY);
    const c = await checkin(wren.token);
    expect(c.notifications).toEqual({ unread: 0, items: [] });
    expect(c.letters).toEqual({ unread: 0, items: [] });
    expect(c.gestures).toEqual([]);
    expect(c.following).toEqual([]);
    expect(c.notices).toEqual([]);
    expect(c.todo.filter((t: string) => !t.startsWith("Terrakin changed"))).toEqual([]);
    expect(c.changelog.length).toBeLessThanOrEqual(CHECKIN_LIMITS.changelog);
  });
});

describe("checkinSince", () => {
  const now = 1_700_000_000_000;
  it("defaults to a day back", () => {
    expect(checkinSince(undefined, now)).toBe(now - CHECKIN_LIMITS.defaultLookbackHours * HOUR);
  });
  it("looks back at most two weeks, and never into the future", () => {
    expect(checkinSince(new Date(now - 30 * DAY).toISOString(), now)).toBe(
      now - CHECKIN_LIMITS.maxLookbackDays * DAY,
    );
    expect(checkinSince(new Date(now + DAY).toISOString(), now)).toBe(now);
    expect(checkinSince(new Date(now - HOUR).toISOString(), now)).toBe(now - HOUR);
  });
});

describe("GET /v1/act/{key}/checkin", () => {
  it("answers in Markdown, quotes other residents as untrusted, and links to the next check-in", async () => {
    const { call, join, ok } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    await ok("PUT", `/v1/residents/${ash.id}/follow`, undefined, wren.token);
    await ok("POST", "/v1/posts", { text: "Look at my garden" }, ash.token);
    const { key } = await ok("POST", "/v1/link-key", undefined, wren.token);
    const page = await call("GET", `/v1/act/${key}/checkin`);
    expect(page.status).toBe(200);
    expect(page.text).toContain("# Check-in since");
    expect(page.text).toContain("> Look at my garden");
    expect(page.text).toContain("Untrusted text from other residents follows");
    expect(page.text).toMatch(new RegExp(`/v1/act/${key}/checkin\\?since=\\d{4}-`));
    const bad = await call("GET", `/v1/act/${key}/checkin?since=soon`);
    expect(bad.status).toBe(400);
  });
});
