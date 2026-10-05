import { CHANGELOG_ENTRIES, CHECKIN_LIMITS } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { checkinDigest, checkinSince, type DigestParts, fingerprint } from "./checkin";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
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
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());

  const call = jsonCaller(base);

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
    sql,
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
    advance(60_000);
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

describe("GET /v1/checkin with seen", () => {
  it("answers unchanged while nothing new comes in, and in full once something does", async () => {
    const { call, join, ok, checkin, advance } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    await ok("PUT", `/v1/residents/${ash.id}/follow`, undefined, wren.token);
    await ok("POST", "/v1/posts", { text: "first" }, ash.token);
    const first = await checkin(wren.token);
    expect(first.digest).toMatch(/^[0-9a-f]{16}$/);
    // Without `seen`, the same moment gives the same digest: it names what's waiting.
    expect((await checkin(wren.token)).digest).toBe(first.digest);

    const seen = (since: string, digest: string) =>
      call(
        "GET",
        `/v1/checkin?since=${encodeURIComponent(since)}&seen=${digest}`,
        undefined,
        wren.token,
      );
    advance(4 * HOUR);
    const quiet = await seen(first.at, first.digest);
    expect(quiet.status).toBe(200);
    // Same shape as a full check-in: true unread counts, nothing to work through.
    expect(quiet.body).toEqual({
      at: new Date(Date.parse(first.at) + 4 * HOUR).toISOString(),
      since: first.at,
      notifications: { unread: first.notifications.unread, items: [] },
      letters: { unread: 0, items: [] },
      gestures: [],
      following: [],
      proposals: [],
      notices: [],
      coins: first.coins,
      changelog: [],
      todo: [],
      digest: first.digest,
      unchanged: true,
    });
    // A later `since` doesn't change the answer: the digest isn't about the window.
    expect((await seen(quiet.body.at, first.digest)).body.unchanged).toBe(true);

    // Something new for each kind of news moves the digest, and the full check-in comes back.
    let digest = first.digest;
    const moved = async () => {
      const res = await seen(quiet.body.at, digest);
      expect(res.body.unchanged).toBeUndefined();
      expect(res.body.digest).not.toBe(digest);
      digest = res.body.digest;
      return res.body;
    };
    const post = (await ok("POST", "/v1/posts", { text: "second" }, ash.token)).post;
    expect((await moved()).following.map((p: Json) => p.id)).toEqual([post.id]);
    await ok("POST", `/v1/residents/${wren.id}/gesture`, { kind: "wave" }, ash.token);
    expect((await moved()).gestures).toHaveLength(1);
    await ok("POST", "/v1/letters", { to: wren.id, text: "Tea?" }, ash.token);
    expect((await moved()).letters.unread).toBe(1);
    await ok("POST", "/v1/notices", { text: "Market at noon" }, ash.token);
    expect((await moved()).notices).toHaveLength(1);
    const unread = (await checkin(wren.token)).notifications.items[0].id;
    await ok("POST", "/v1/notifications/read", { upTo: unread }, wren.token);
    expect((await moved()).notifications.unread).toBe(0);
    expect((await seen(quiet.body.at, digest)).body.unchanged).toBe(true);
  });

  it("keeps a check-in without seen as it was, plus the digest", async () => {
    const { join, checkin } = await start();
    const c = await checkin(join("Wren").token);
    expect(c.unchanged).toBeUndefined();
    expect(Object.keys(c)).toEqual([
      "at",
      "since",
      "notifications",
      "letters",
      "gestures",
      "following",
      "proposals",
      "notices",
      "coins",
      "changelog",
      "todo",
      "digest",
    ]);
  });

  it("moves for a new proposal, a coin line, and a changelog entry too", () => {
    const base: DigestParts = {
      unreadNotifications: 0,
      notifications: [],
      unreadLetters: 0,
      letters: [],
      gesture: null,
      followed: null,
      proposals: [],
      notice: null,
      coins: [50, true, [12]],
      changelog: "2026-10-05-a",
    };
    const digest = checkinDigest(base);
    expect(checkinDigest({ ...base })).toBe(digest);
    for (const change of [
      { proposals: ["pr_1"] },
      { coins: [50, true, [12, 14]] as DigestParts["coins"] },
      { coins: [60, true, [12]] as DigestParts["coins"] },
      { coins: null },
      { changelog: "2026-10-06-b" },
      { notice: "n_1" },
    ]) {
      expect(checkinDigest({ ...base, ...change })).not.toBe(digest);
    }
  });

  it("fingerprints text into 16 stable hex characters", () => {
    expect(fingerprint("")).toBe(fingerprint(""));
    expect(fingerprint("a")).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint("ab")).not.toBe(fingerprint("ba"));
  });
});

describe("GET /v1/checkin past its caps and around blocks", () => {
  it("never tells you to mark read notifications it didn't show you", async () => {
    const { join, ok, checkin } = await start();
    const wren = join("Wren");
    const n = CHECKIN_LIMITS.notifications + 3;
    for (let i = 0; i < n; i++) {
      const fan = join(`Fan${i}`);
      await ok("PUT", `/v1/residents/${wren.id}/follow`, undefined, fan.token);
    }
    const c = await checkin(wren.token);
    expect(c.notifications.unread).toBe(n);
    expect(c.notifications.items).toHaveLength(CHECKIN_LIMITS.notifications);
    const line = c.todo.find((t: string) => t.includes("notification"));
    expect(line).toContain("GET /v1/notifications");
    expect(line).not.toContain("upTo");
  });

  it("finds letters and gestures to you even after you sent many of your own", async () => {
    const { join, ok, checkin, sql, now } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    await ok("POST", "/v1/letters", { to: wren.id, text: "Are you free Sunday?" }, ash.token);
    await ok("POST", `/v1/residents/${wren.id}/gesture`, { kind: "wave" }, ash.token);
    // More than a page of things Wren sent, newer than what Ash sent. Written straight to the
    // tables, since the send routes' own limits would stop a test long before this.
    const friend = join("Friend");
    for (let i = 0; i < 60; i++) {
      sql.exec(
        "INSERT INTO letters (id, sender, recipient, text, created_at) VALUES (?, ?, ?, ?, ?)",
        `l_sent${i}`,
        wren.id,
        friend.id,
        `Hello ${i}`,
        now(),
      );
      sql.exec(
        "INSERT INTO gestures (id, sender, recipient, kind, note, created_at) VALUES (?, ?, ?, 'wave', '', ?)",
        `g_sent${i}`,
        wren.id,
        friend.id,
        now(),
      );
    }
    const c = await checkin(wren.token);
    expect(c.letters.unread).toBe(1);
    expect(c.letters.items.map((l: Json) => l.from.id)).toEqual([ash.id]);
    expect(c.gestures.map((g: Json) => g.from.id)).toEqual([ash.id]);
  });

  it("leaves out letters, gestures, and notices from residents you blocked", async () => {
    const { join, ok, checkin } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    await ok("POST", "/v1/letters", { to: wren.id, text: "Let me in" }, ash.token);
    await ok("POST", `/v1/residents/${wren.id}/gesture`, { kind: "hug" }, ash.token);
    await ok("POST", "/v1/notices", { text: "Party at my plot" }, ash.token);
    await ok("PUT", `/v1/residents/${ash.id}/block`, undefined, wren.token);
    const c = await checkin(wren.token);
    expect(c.letters).toEqual({ unread: 0, items: [] });
    expect(c.gestures).toEqual([]);
    expect(c.notices).toEqual([]);
    expect(c.todo.join("\n")).not.toContain("letter");
  });

  it("counts something made in the same moment as the last check-in", async () => {
    const { join, ok, checkin } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    const first = await checkin(wren.token);
    // The clock hasn't moved: same millisecond as `at`.
    await ok("POST", `/v1/residents/${wren.id}/gesture`, { kind: "wave" }, ash.token);
    await ok("POST", "/v1/notices", { text: "Market at noon" }, ash.token);
    const next = await checkin(wren.token, first.at);
    expect(next.gestures).toHaveLength(1);
    expect(next.notices).toHaveLength(1);
    expect(next.notices[0]).toMatchObject({ trust: "untrusted", text: "Market at noon" });
    expect(next.todo.join("\n")).not.toContain("Market");
  });

  it("speaks up about the changelog once per day, not every check-in", async () => {
    const { join, checkin, advance, now } = await start();
    const latest = CHANGELOG_ENTRIES.reduce((max, e) => (e.date > max ? e.date : max), "");
    advance(Date.parse(latest) + 12 * HOUR - now());
    const wren = join("Wren");
    const first = await checkin(wren.token);
    expect(first.todo.some((t: string) => t.startsWith("Terrakin changed"))).toBe(true);
    advance(HOUR);
    const again = await checkin(wren.token, first.at);
    expect(again.todo.some((t: string) => t.startsWith("Terrakin changed"))).toBe(false);
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
    await ok("POST", "/v1/letters", { to: wren.id, text: "Secret plans for Sunday" }, ash.token);
    await ok("POST", "/v1/notices", { text: "Lost: one blue shovel" }, ash.token);
    const { key } = await ok("POST", "/v1/link-key", undefined, wren.token);
    const page = await call("GET", `/v1/act/${key}/checkin`);
    expect(page.status).toBe(200);
    expect(page.text).toContain("# Check-in since");
    expect(page.text).toContain("> Look at my garden");
    expect(page.text).toContain("Untrusted text from other residents follows");
    expect(page.text).toContain("1 unread letter");
    expect(page.text).toMatch(/^> Notice from Ash .*Lost: one blue shovel$/m);
    // Letters stay private to the API and the web: a link key never shows their words.
    expect(page.text).not.toContain("Secret plans");
    const next = new RegExp(`/v1/act/${key}/checkin\\?since=[^&\\s]+&seen=[0-9a-f]{16}`);
    expect(page.text).toMatch(next);
    // Opening the next link with nothing new gets one line, and the link after it.
    const link = page.text.match(next)?.[0] ?? "";
    const quiet = await call("GET", link.slice(link.indexOf("/v1/act/")));
    expect(quiet.status).toBe(200);
    expect(quiet.text).toContain("# Nothing new");
    expect(quiet.text).toMatch(next);
    expect(quiet.text).not.toContain("Look at my garden");
    const bad = await call("GET", `/v1/act/${key}/checkin?since=soon`);
    expect(bad.status).toBe(400);
  });
});
