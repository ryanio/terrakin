import {
  CATALOG_VERSION,
  CHANGELOG_ENTRIES,
  CHECKIN_LIMITS,
  CHECKIN_SUGGESTED_HOURS,
  DEVLOG_POSTS,
} from "@terrakin/protocol";
import { dayOfDate, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { checkinDigest, checkinSince, type DigestParts, fingerprint } from "./checkin";
import { CRANBERRY_KINDS, PUMPKIN_KINDS, pickTryNext, TRY_NEXT } from "./checkin-suggest";
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

async function start(
  world: {
    days?: boolean;
    economy?: boolean;
    items?: boolean;
    shop?: boolean;
    finds?: boolean;
    bounties?: boolean;
  } = {},
) {
  let now = 1_700_000_000_000;
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    ...world,
  });
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
    service,
    social,
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

  it("asks you to answer only the gestures someone chose to send", async () => {
    const { join, ok, checkin, social } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    const bo = join("Bo");
    const wave = { kind: "wave" as const };
    expect(social.together.sendGesture(ash.id, wren.id, wave, { putter: true }).ok).toBe(true);
    expect(social.together.sendGesture(bo.id, wren.id, wave, { routine: { max: 3 } }).ok).toBe(
      true,
    );
    const waved = await checkin(wren.token);
    expect(waved.gestures).toHaveLength(2);
    expect(waved.todo.some((t: string) => t.includes("Send one back"))).toBe(false);
    await ok("POST", `/v1/residents/${wren.id}/gesture`, { kind: "hug" }, ash.token);
    const hugged = await checkin(wren.token);
    expect(hugged.gestures).toHaveLength(3);
    expect(hugged.todo).toContain(
      "1 gesture came in. Send one back with POST /v1/residents/{id}/gesture if your owner would like to.",
    );
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
    // A newcomer's first-visit steps aside, nothing is waiting.
    const waiting = c.todo.filter(
      (t: string) =>
        !t.startsWith("Terrakin changed") &&
        !t.startsWith("The Terrakin devlog") &&
        !t.startsWith("First visit:"),
    );
    expect(waiting).toEqual([]);
    expect(c.changelog.length).toBeLessThanOrEqual(CHECKIN_LIMITS.changelog);
  });
});

describe("GET /v1/checkin with seen", () => {
  it("answers unchanged while nothing new comes in, and in full once something does", async () => {
    const { call, join, ok, checkin, advance } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    // Only a resident done with their first visit can get `unchanged`.
    await settleIn(ok, wren.token, ash.id);
    // With a pet already, building is the one thing to try, and the first check-in suggests it.
    const pet = { type: "adopt_pet", kind: "cat", coat: "tabby", name: "Moss" };
    await ok("POST", "/v1/actions", pet, wren.token);
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
      // What it's like out comes with every answer: mid-November is autumn, and the time of day is
      // the map's. So does the catalog's version, so an agent knows when to read GET /v1/catalog
      // again.
      weather: expect.any(String),
      timeOfDay: expect.any(String),
      season: "autumn",
      catalog: CATALOG_VERSION,
      notifications: { unread: first.notifications.unread, items: [] },
      letters: { unread: 0, items: [] },
      gestures: [],
      following: [],
      proposals: [],
      notices: [],
      coins: first.coins,
      changelog: [],
      away: { items: [], refused: 0 },
      events: { soon: [], live: [] },
      todo: [],
      firstVisit: [],
      tryToday: null,
      digest: first.digest,
      unchanged: true,
      everyHours: CHECKIN_SUGGESTED_HOURS,
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

  it("keeps a check-in without seen as it was, plus the digest and the rhythm", async () => {
    const { join, checkin } = await start();
    const c = await checkin(join("Wren").token);
    expect(c.unchanged).toBeUndefined();
    expect(Object.keys(c)).toEqual([
      "at",
      "since",
      "season",
      "weather",
      "timeOfDay",
      "catalog",
      "notifications",
      "letters",
      "gestures",
      "following",
      "proposals",
      "notices",
      "coins",
      "changelog",
      "devlog",
      "away",
      "events",
      "todo",
      "firstVisit",
      "tryToday",
      "digest",
      "everyHours",
    ]);
  });

  it("moves for a new proposal, a coin line, a changelog entry, and a devlog post too", () => {
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
      devlog: "2026-10-05",
    };
    const digest = checkinDigest(base);
    expect(checkinDigest({ ...base })).toBe(digest);
    for (const change of [
      { proposals: ["pr_1"] },
      { coins: [50, true, [12, 14]] as DigestParts["coins"] },
      { coins: [60, true, [12]] as DigestParts["coins"] },
      { coins: null },
      { changelog: "2026-10-06-b" },
      { devlog: "2026-10-06" },
      { notice: "n_1" },
      { items: [["3,3"], 0] as [string[], number] },
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

describe("the devlog in the check-in", () => {
  it("names the newest post once, from when this world first served it", async () => {
    const { join, checkin, advance } = await start();
    const newest = DEVLOG_POSTS[0];
    if (!newest) throw new Error("docs/devlog has no posts");
    const wren = join("Wren");
    const ash = join("Ash");
    const told = (c: Json) => c.todo.filter((t: string) => t.startsWith("The Terrakin devlog"));

    // Wren's is the first check-in since the post came out here, so it has the post.
    const first = await checkin(wren.token);
    const { body: _, ...entry } = newest;
    expect(first.devlog).toEqual(entry);
    expect(told(first)).toEqual([
      `The Terrakin devlog has a new post for people (\`devlog\`, ${newest.date}). Read it at ${newest.url} and tell your owner about it if they'd care.`,
    ]);

    // Sending the last `at` as `since`, it doesn't come again.
    advance(4 * HOUR);
    const again = await checkin(wren.token, first.at);
    expect(again.devlog).toBeUndefined();
    expect(told(again)).toEqual([]);

    // It came out when Wren first asked, for everyone: a since before then has it, a since
    // after then doesn't, however long ago the post's own day was.
    const came = Date.parse(first.at);
    const before = await checkin(ash.token, new Date(came - HOUR).toISOString());
    expect(before.devlog?.date).toBe(newest.date);
    const after = await checkin(ash.token, new Date(came + HOUR).toISOString());
    expect(after.devlog).toBeUndefined();
  });
});

type Ok = (method: string, path: string, body: unknown, token: string) => Promise<Json>;

/**
 * Every first-visit step: a plot, a home, a plot name (unless `named` is false), a handle, a bio, a
 * look, a post, and someone followed.
 */
async function settleIn(
  ok: Ok,
  token: string,
  follow: string,
  { handle = "wren", named = true } = {},
) {
  await ok("POST", "/v1/actions", { type: "settle", px: 1, py: 1 }, token);
  await ok("POST", "/v1/actions", { type: "build_starter_home" }, token);
  if (named) {
    const name = { type: "name_plot", px: 1, py: 1, name: "Wren's Rest" };
    await ok("POST", "/v1/actions", name, token);
  }
  await ok("PUT", "/v1/profile", { handle, bio: "a muse" }, token);
  await ok("POST", "/v1/actions", { type: "profile", theme: "meadow" }, token);
  await ok("POST", "/v1/posts", { text: "Hello" }, token);
  await ok("PUT", `/v1/residents/${follow}/follow`, undefined, token);
}

describe("first-visit steps and things to try", () => {
  const tryLine = (c: Json) => c.todo.find((t: string) => t.startsWith("Something to try today"));

  it("names each first-visit step until it's done, with a todo line each", async () => {
    const { join, ok, checkin } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    const first = await checkin(wren.token);
    expect(first.everyHours).toBe(CHECKIN_SUGGESTED_HOURS);
    // No items in this world, so no garden step; no plot yet, so no home step.
    expect(first.firstVisit).toEqual(["plot", "handle", "bio", "look", "post", "follow"]);
    const lines = first.todo.filter((t: string) => t.startsWith("First visit:"));
    expect(lines).toHaveLength(first.firstVisit.length);
    expect(first.todo.slice(0, lines.length)).toEqual(lines);
    await ok("POST", "/v1/actions", { type: "settle", px: 1, py: 1 }, wren.token);
    expect((await checkin(wren.token)).firstVisit).toContain("home");
    await settleIn(ok, wren.token, ash.id);
    const done = await checkin(wren.token);
    expect(done.firstVisit).toEqual([]);
    expect(done.todo.some((t: string) => t.startsWith("First visit:"))).toBe(false);
  });

  it("never answers unchanged while a first-visit step is left", async () => {
    const { join, call, checkin } = await start();
    const wren = join("Wren");
    const first = await checkin(wren.token);
    const again = await call(
      "GET",
      `/v1/checkin?since=${encodeURIComponent(first.at)}&seen=${first.digest}`,
      undefined,
      wren.token,
    );
    expect(again.body.unchanged).toBeUndefined();
    expect(again.body.firstVisit).toEqual(first.firstVisit);
  });

  it("keeps a step added after you joined out of your first visit, and suggests it only with news", async () => {
    const { join, ok, call, checkin, advance, now } = await start();
    // Ivy and Ash join on October 5, 2026, the day before plots had names to give.
    advance(Date.UTC(2026, 9, 5, 12) - now());
    const ivy = join("Ivy");
    const ash = join("Ash");
    const before = await checkin(ivy.token);
    await ok("POST", "/v1/actions", { type: "settle", px: 3, py: 1 }, ash.token);
    await settleIn(ok, ivy.token, ash.id, { handle: "ivy", named: false });
    // Everything else there is to suggest in this world is done too: a pet, a path, a visit.
    const pet = { type: "adopt_pet", kind: "cat", coat: "ginger", name: "Moss" };
    await ok("POST", "/v1/actions", pet, ivy.token);
    const path = { type: "build", px: 1, py: 1, ground: [{ x: 0, y: 0, ground: "dirt" }] };
    await ok("POST", "/v1/actions", path, ivy.token);
    await ok("POST", "/v1/actions", { type: "visit", px: 3, py: 1 }, ivy.token);

    // A day on, a newcomer's first visit asks for a plot name like every other step.
    advance(DAY);
    const juno = join("Juno");
    await ok("POST", "/v1/actions", { type: "settle", px: 5, py: 1 }, juno.token);
    expect((await checkin(juno.token)).firstVisit).toContain("plot_name");

    // Ivy's first visit is done without it, so with nothing new her check-in is unchanged.
    const seen = async (digest: string) =>
      (
        await call(
          "GET",
          `/v1/checkin?since=${encodeURIComponent(before.at)}&seen=${digest}`,
          undefined,
          ivy.token,
        )
      ).body;
    expect(await seen(before.digest)).toMatchObject({
      unchanged: true,
      firstVisit: [],
      tryToday: null,
      todo: [],
    });
    // Once something comes in, it rides along as today's suggestion, with the call that does it.
    await ok("POST", `/v1/residents/${ivy.id}/gesture`, { kind: "wave" }, ash.token);
    const news = await seen(before.digest);
    expect(news.unchanged).toBeUndefined();
    expect(news.tryToday).toBe("plot_name");
    const line = tryLine(news);
    expect(line).toContain(
      '{"type": "name_plot", "px": 1, "py": 1, "name": "<its name>"}. It\'s a first-visit step added after you joined.',
    );
    // Once a day at most.
    expect((await seen(news.digest)).unchanged).toBe(true);
    // Not done, it comes back a week on, sooner than other suggestions: not six days on, even with news.
    advance(6 * DAY);
    await ok("POST", "/v1/notices", { text: "Tea at the well" }, ash.token);
    expect((await seen(news.digest)).tryToday).toBeNull();
    advance(DAY);
    await ok("POST", "/v1/notices", { text: "Soup at noon" }, ash.token);
    expect((await seen(news.digest)).tryToday).toBe("plot_name");
  });

  it("suggests the first thing that fits, once a UTC day, and not again for a month", async () => {
    const { join, ok, checkin, advance } = await start({ days: true, economy: true, items: true });
    const wren = join("Wren");
    const ash = join("Ash");
    await settleIn(ok, wren.token, ash.id);
    // She has a pet already, so it isn't one to suggest (the next test covers when it is).
    const pet = { type: "adopt_pet", kind: "dog", coat: "golden", name: "Rex" };
    await ok("POST", "/v1/actions", pet, wren.token);
    // The garden step: a planter in the hut's corner and a seed in it.
    await ok("POST", "/v1/actions", { type: "place", x: 6, y: 6, block: "planter" }, wren.token);
    await ok("POST", "/v1/actions", { type: "plant", x: 6, y: 6, seed: "flower" }, wren.token);
    const morning = await checkin(wren.token);
    expect(morning.firstVisit).toEqual([]);
    expect(morning.tryToday).toBe("gather");
    expect(tryLine(morning)).toContain("Gather a branch or a stone");
    const later = await checkin(wren.token, morning.at);
    expect(later.tryToday).toBeNull();
    expect(tryLine(later)).toBeUndefined();
    advance(DAY);
    const next = await checkin(wren.token);
    expect(next.tryToday).toBe("build");
    expect(tryLine(next)).toContain("lay a path out of your door");
    advance(DAY);
    expect((await checkin(wren.token)).tryToday).toBe("games");
    // Her plot is 3 days old, so she may vote, but nothing is open to vote on: no Town Hall.
    // Nothing else fits yet (crafting waits for a harvest), and each waits a month.
    advance(DAY);
    expect((await checkin(wren.token)).tryToday).toBeNull();
    // Gather comes back 30 days after it was suggested, not a day sooner.
    advance(26 * DAY);
    expect((await checkin(wren.token)).tryToday).toBeNull();
    advance(DAY);
    expect((await checkin(wren.token)).tryToday).toBe("gather");
  });

  it("waits for each suggestion's prerequisites, in order", async () => {
    const { join, ok, service } = await start({ days: true, economy: true, items: true });
    const wren = join("Wren");
    await ok("POST", "/v1/actions", { type: "settle", px: 1, py: 1 }, wren.token);
    const pick = (done: string[]) =>
      pickTryNext(service.state, wren.id, new Set(done), new Set())?.id ?? null;
    expect(pick([])).toBe("plant");
    expect(pick(["plant", "gather"])).toBe("build");
    // Fishing (RFC 0023) once there's been some building, then the games.
    expect(pick(["plant", "gather", "lay"])).toBe("fish");
    expect(pick(["plant", "gather", "lay", "fish"])).toBe("games");
    expect(pick(["plant", "gather", "lay", "fish", "sit"])).toBeNull();
    const done = ["plant", "gather", "build", "fish"];
    expect(pick([...done, "harvest"])).toBe("craft");
    // Furniture from a workbench stacks and goes on the plot, so it leaves nothing to display.
    expect(pick([...done, "harvest", "craft"])).toBe("give");
    // A made thing straight into her things, as crafting jam would.
    const items = service.state.items;
    if (!items) throw new Error("items closed");
    const inv = items.inventories[wren.id] ?? { stacks: {}, goods: [] };
    inv.goods.push({ id: `i_${items.nextId++}`, kind: "lemon_jam", maker: wren.id, madeDay: 1 });
    items.inventories[wren.id] = inv;
    expect(pick([...done, "harvest", "craft"])).toBe("display");
    expect(pick([...done, "harvest", "craft", "display"])).toBe("give");
    expect(pick([...done, "harvest", "craft", "display", "give"])).toBe("gallery");
    // Nothing on display but your own, so there's nothing to admire.
    expect(
      pick([...done, "harvest", "craft", "display", "give", "set_gallery", "open_table"]),
    ).toBeNull();
    // A pet waits for a hearth, and stops once one is home.
    await ok("POST", "/v1/actions", { type: "build_starter_home" }, wren.token);
    expect(pick(["plant", "gather"])).toBe("pet");
    const pet = { type: "adopt_pet", kind: "cat", coat: "ginger", name: "Biscuit" };
    await ok("POST", "/v1/actions", pet, wren.token);
    expect(pick(["plant", "gather"])).toBe("build");
  });

  it("suggests the Town Hall only while there's a proposal you can vote on", async () => {
    const { join, ok, service, advance } = await start({ days: true });
    const [wren, ash, bo] = [join("Wren"), join("Ash"), join("Bo")];
    for (const [r, px] of [
      [wren, 1],
      [ash, 3],
      [bo, 5],
    ] as const) {
      await ok("POST", "/v1/actions", { type: "settle", px, py: 1 }, r.token);
      await ok("POST", "/v1/actions", { type: "build_starter_home" }, r.token);
    }
    // Three days on, all three may vote. Everything before the Town Hall is done.
    advance(3 * DAY);
    service.tick();
    const done = new Set(["adopt_pet", "build", "visit", "sit"]);
    const pick = () => pickTryNext(service.state, wren.id, done, new Set())?.id ?? null;
    expect(pick()).toBeNull();
    const advisory = { type: "propose", kind: "advisory", title: "More benches by the well" };
    await ok("POST", "/v1/actions", advisory, ash.token);
    expect(pick()).toBe("town_hall");
  });

  it("suggests pumpkins in autumn to a gardener with none, and stops once they have some", async () => {
    const world = { days: true, economy: true, items: true, shop: true };
    const { join, ok, service, advance } = await start(world);
    const wren = join("Wren");
    const ash = join("Ash");
    await ok("POST", "/v1/actions", { type: "settle", px: 1, py: 1 }, wren.token);
    await ok("POST", "/v1/actions", { type: "settle", px: 3, py: 1 }, ash.token);
    const gardener = new Set(["plant", "gather", "harvest", "craft", "build", "fish"]);
    const pick = (id: string) => pickTryNext(service.state, id, gardener, new Set())?.id ?? null;
    // The test clock starts on 2023-11-14, in autumn.
    expect(pick(wren.id)).toBe("pumpkins");
    expect(pick(ash.id)).toBe("pumpkins");
    await ok("POST", "/v1/actions", { type: "shop_buy", sku: "pumpkin_seed" }, ash.token);
    // Next comes a visit: Wren lives next door (RFC 0020).
    expect(pick(ash.id)).toBe("visit");
    // December 1 is winter: the shop has no pumpkin seeds to sell, and cranberries come first.
    advance(17 * DAY);
    service.tick();
    expect(pick(wren.id)).toBe("cranberries");
    expect(pick(ash.id)).toBe("cranberries");
  });

  it("suggests cranberries in winter to a gardener with none, and stops once they have some", async () => {
    const world = { days: true, economy: true, items: true, shop: true };
    const { join, ok, service, advance } = await start(world);
    const wren = join("Wren");
    await ok("POST", "/v1/actions", { type: "settle", px: 1, py: 1 }, wren.token);
    const gardener = new Set(["plant", "gather", "harvest", "craft", "build", "fish"]);
    const pick = () => pickTryNext(service.state, wren.id, gardener, new Set());
    // The test clock starts on 2023-11-14, in autumn: December 1 is 17 days on.
    expect(pick()?.id).toBe("pumpkins");
    advance(17 * DAY);
    service.tick();
    const winter = pick();
    expect(winter?.id).toBe("cranberries");
    expect(winter?.line).toContain('{"type": "shop_buy", "sku": "cranberry_seed", "count": 2}');
    await ok("POST", "/v1/actions", { type: "shop_buy", sku: "cranberry_seed" }, wren.token);
    expect(pick()?.id).not.toBe("cranberries");
    // March 1 is spring: the shop sells no cranberry seeds, so a newcomer isn't told about them.
    advance((dayOfDate(2024, 3, 1) - (service.state.day ?? 0)) * DAY);
    service.tick();
    expect(service.state.day).toBe(dayOfDate(2024, 3, 1));
    const ash = join("Ash");
    await ok("POST", "/v1/actions", { type: "settle", px: 3, py: 1 }, ash.token);
    expect(pickTryNext(service.state, ash.id, gardener, new Set())?.id).toBe("visit");
  });
  it("reads a season's crop from the catalog: its seeds, the crop, and the goods made from it", () => {
    expect(PUMPKIN_KINDS).toEqual(
      new Set(["pumpkin_seed", "pumpkin", "pumpkin_pie", "pumpkin_soup"]),
    );
    expect(CRANBERRY_KINDS).toEqual(
      new Set(["cranberry_seed", "cranberry", "cranberry_jam", "cranberry_punch"]),
    );
  });
});

describe("the order of a check-in's todo lines", () => {
  it("puts first-visit steps first and today's suggestion last, with everything else in between in one order", async () => {
    const world = { days: true, economy: true, items: true, bounties: true };
    const { join, ok, checkin, advance, service, social, now } = await start(world);
    const [wren, ash, bo] = [join("Wren"), join("Ash"), join("Bo")];
    const act = (token: string, action: Json) => ok("POST", "/v1/actions", action, token);
    for (const [r, px] of [
      [wren, 1],
      [ash, 3],
      [bo, 5],
    ] as const) {
      await act(r.token, { type: "settle", px, py: 1 });
      await act(r.token, { type: "build_starter_home" });
    }
    await act(wren.token, { type: "place", x: 6, y: 6, block: "planter" });
    await act(wren.token, { type: "plant", x: 6, y: 6, seed: "flower" });
    await act(wren.token, { type: "adopt_pet", kind: "cat", coat: "ginger", name: "Moss" });
    for (let d = 0; d < 3; d++) {
      advance(DAY);
      service.tick();
    }
    // Events (RFC 0010): one on now that Wren is going to, one on now she isn't, then a new day
    // with Wren away from her hearth, so today's coins wait for her.
    const at = (hours: number) => new Date(Math.floor(now() / HOUR + hours) * HOUR).toISOString();
    const event = (px: number, hours: number) => ({
      type: "schedule_event",
      kind: "listening",
      title: "Records",
      text: "Bring a song.",
      px,
      py: 1,
      startsAt: at(hours),
      minutes: 60,
    });
    await act(ash.token, event(3, 2));
    await act(bo.token, event(5, 2));
    await ok("POST", "/v1/events/e_1/going", undefined, wren.token);
    await act(wren.token, { type: "move", dir: "n" });
    advance(2 * HOUR + 60_000);
    service.tick();
    // One she hosts, and one she's going to, both coming up.
    await act(wren.token, event(1, 2));
    await act(ash.token, event(3, 3));
    await ok("POST", "/v1/events/e_4/going", undefined, wren.token);
    // Two tables: one waiting on her move, and one she can start.
    await act(wren.token, { type: "open_table", game: "hearth_race", pace: "slow" });
    await act(ash.token, { type: "sit", table: "g_1" });
    await act(wren.token, { type: "start_game", table: "g_1" });
    await act(wren.token, { type: "open_table", game: "hearth_race", pace: "slow" });
    await act(ash.token, { type: "sit", table: "g_2" });
    // A thing and coins as gifts, and bounties: hers done, one that paid her, and a new one.
    await act(ash.token, { type: "give", to: wren.id, item: "flower_seed" });
    await act(ash.token, { type: "give_coins", to: wren.id, amount: 1 });
    const bounty = { type: "post_bounty", title: "Water my lemons", text: "Twice.", reward: 5 };
    await act(wren.token, bounty);
    await act(ash.token, { type: "claim_bounty", bounty: "b_1" });
    await act(ash.token, { type: "complete_bounty", bounty: "b_1" });
    await act(ash.token, bounty);
    await act(wren.token, { type: "claim_bounty", bounty: "b_2" });
    await act(ash.token, { type: "confirm_bounty", bounty: "b_2", to: wren.id });
    await act(ash.token, bounty);
    // A post staff took down, an admire, a pat, a mention, a letter, a wave, and a proposal.
    const taken = (await ok("POST", "/v1/posts", { text: "Buy my stuff" }, wren.token)).post;
    expect((await social.safety.hidePost("staff", taken.id, "spam", "spam")).ok).toBe(true);
    await act(ash.token, { type: "visit", px: 1, py: 1 });
    await ok("POST", "/v1/plots/1/1/admire", undefined, ash.token);
    await ok("POST", `/v1/residents/${wren.id}/pet/pat`, undefined, ash.token);
    await ok("PUT", "/v1/profile", { handle: "wren" }, wren.token);
    await ok("PUT", `/v1/residents/${ash.id}/follow`, undefined, wren.token);
    await ok("POST", "/v1/posts", { text: "Morning @wren" }, ash.token);
    await ok("POST", "/v1/letters", { to: wren.id, text: "Tea later?" }, ash.token);
    await ok("POST", `/v1/residents/${wren.id}/gesture`, { kind: "wave" }, ash.token);
    await act(ash.token, { type: "propose", kind: "advisory", title: "More benches" });

    // Each line's start, with resident ids left out.
    const starts = (c: Json) =>
      c.todo.map((t: string) => t.replace(/r_[0-9a-f]+/g, "<id>").slice(0, 32));
    const between = [
      "Your move at table g_1 (Hearth r",
      "Table g_2 has enough players, an",
      "Come home to your hearth for tod",
      '1 crop you planted is ready: {"t',
      "1 thing came in as gifts today. ",
      "Staff took down something of you",
      "<id> says your bounty b_1 is don",
      "1 bounty or grant paid you today",
      "1 bounty posted since 2023-11-17",
      "1 gift of coins came in today. T",
      "1 resident admired your plot (`p",
      "You have 6 unread notifications.",
      "Residents patted your pet or gav",
      "You have 1 unread letter. Open e",
      "1 gesture came in. Send one back",
      "Proposal t_1 is open and you hav",
      "1 new post from people you follo",
      "Your event e_3 starts in 2 hours",
      "e_4 starts in 3 hours (2023-11-1",
      "e_1, which you said you're going",
      "1 event is on now (e_2). Read th",
      "Terrakin changed. Read `changelo",
      "The Terrakin devlog has a new po",
    ];
    expect(starts(await checkin(wren.token))).toEqual([
      "First visit: write a short bio: ",
      "First visit: choose a look from ",
      "First visit: introduce yourself ",
      ...between,
    ]);
    // With her first visit done, the same check-in ends with today's suggestion: naming her plot,
    // a step added after the test clock's 2023, when she joined.
    await ok("PUT", "/v1/profile", { bio: "a muse" }, wren.token);
    await act(wren.token, { type: "profile", theme: "meadow" });
    await ok("POST", "/v1/posts", { text: "Hello" }, wren.token);
    expect(starts(await checkin(wren.token))).toEqual([
      ...between,
      "Something to try today: name you",
    ]);
  });
});

describe("suggestions from the collection book (RFC 0021)", () => {
  it("suggest foraging until the book has a find, then the last find of a family that lies now", async () => {
    const { join, ok, service } = await start({
      days: true,
      economy: true,
      items: true,
      finds: true,
    });
    const wren = join("Wren");
    await ok("POST", "/v1/actions", { type: "settle", px: 1, py: 1 }, wren.token);
    // Every other suggestion set aside, so each is asked about on its own.
    const only = (id: string) => new Set(TRY_NEXT.map((t) => t.id).filter((other) => other !== id));
    const pick = (id: string, kinds: string[]) =>
      pickTryNext(service.state, wren.id, new Set(), only(id), {
        has: (kind) => kinds.includes(kind),
      });
    expect(pick("forage", [])?.id).toBe("forage");
    expect(pick("forage", ["acorn"])).toBeNull();
    // The test clock is in autumn. Sea glass lies any time of year, so it's named.
    const short = pick("finish_family", ["seashell", "driftwood", "starfish"]);
    expect(short?.id).toBe("finish_family");
    expect(short?.line).toContain('"Shore finds"');
    expect(short?.line).toContain("sea glass. It lies on the sand now and then.");
    // A starfish lies only in summer, and two short is too far: nothing to suggest.
    expect(pick("finish_family", ["seashell", "driftwood", "sea_glass"])).toBeNull();
    expect(pick("finish_family", ["seashell", "driftwood"])).toBeNull();
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
  it("lists first-visit steps a link can do, what's new, and follow links in the feed", async () => {
    const { call, join, ok } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    await ok("POST", "/v1/posts", { text: "Hello from Ash" }, ash.token);
    const { key } = await ok("POST", "/v1/link-key", undefined, wren.token);
    const first = (await call("GET", `/v1/act/${key}/checkin`)).text;
    expect(first).toContain("## Still to do from your first visit");
    expect(first).toContain(`/v1/act/${key}/bio?text=`);
    expect(first).toContain(`/v1/act/${key}/handle?handle=`);
    expect(first).toContain(`/v1/act/${key}/world`);
    expect(first).toContain("This is your first check-in from this link, so it looks back a day.");
    expect(first).toContain("## What's new in Terrakin");
    expect(first).toContain("## New in the devlog");
    expect(first).toContain(DEVLOG_POSTS[0]?.url);
    // The next-time link is the last line, and with steps left the next answer still names them.
    const lastLine = first.trimEnd().split("\n").at(-1) ?? "";
    const next = /\/v1\/act\/k_[\w-]+\/checkin\?since=\S+/.exec(lastLine)?.[0];
    if (!next) throw new Error(`No next link on the last line:\n${first}`);
    const quiet = (await call("GET", next)).text;
    expect(quiet).toContain("## Still to do from your first visit");
    expect(quiet).not.toContain("## New in the devlog");
    const feed = (await call("GET", `/v1/act/${key}/feed`)).text;
    expect(feed).toContain(`Follow Ash: http`);
    expect(feed).toContain(`/v1/act/${key}/follow?resident=${ash.id}`);
    await settleIn(ok, wren.token, ash.id);
    const later = (
      await call(
        "GET",
        `/v1/act/${key}/checkin?since=${encodeURIComponent(new Date().toISOString())}`,
      )
    ).text;
    expect(later).not.toContain("Still to do from your first visit");
  });

  it("brings a first-visit step added after you joined as today's suggestion, with its link", async () => {
    const { call, join, ok, advance, now } = await start();
    // Ivy joins on October 5, 2026, the day before plots had names to give.
    advance(Date.UTC(2026, 9, 5, 12) - now());
    const ivy = join("Ivy");
    const ash = join("Ash");
    const { key } = await ok("POST", "/v1/link-key", undefined, ivy.token);
    const open = async (path: string) => (await call("GET", path)).text;
    const first = await open(`/v1/act/${key}/checkin`);
    const next = /\/v1\/act\/k_[\w-]+\/checkin\?since=\S+/.exec(
      first.trimEnd().split("\n").at(-1) ?? "",
    )?.[0];
    if (!next) throw new Error(`No next link on the last line:\n${first}`);
    // Her first visit done without a plot name. She has no pet and no path yet, which the API's
    // suggestions would bring up, but a link check-in suggests only first-visit steps.
    await settleIn(ok, ivy.token, ash.id, { handle: "ivy", named: false });
    advance(DAY);
    const quiet = await open(next);
    expect(quiet.split("\n")[0]).toBe("# Nothing new");
    expect(quiet).not.toContain("## Something to try today");
    expect(quiet).not.toContain("## Still to do from your first visit");
    // With news, the page brings it up with the link that does it, once a day.
    await ok("POST", `/v1/residents/${ivy.id}/gesture`, { kind: "wave" }, ash.token);
    const news = await open(next);
    expect(news).toContain(
      `## Something to try today\n\nA first-visit step added after you joined, if your owner would like:\n\n- Name your plot, with your owner: http`,
    );
    expect(news).not.toContain("## Still to do from your first visit");
    await ok("POST", "/v1/notices", { text: "Tea at the well" }, ash.token);
    const later = await open(next);
    expect(later).toContain("## New on the Town Hall board");
    expect(later).not.toContain("## Something to try today");
  });

  it("lists what's new on the first check-in of a UTC day, not every time", async () => {
    const { call, join, ok, advance, now } = await start();
    const latest = CHANGELOG_ENTRIES.reduce((max, e) => (e.date > max ? e.date : max), "");
    advance(Date.parse(latest) + 12 * HOUR - now());
    const wren = join("Wren");
    const { key } = await ok("POST", "/v1/link-key", undefined, wren.token);
    const first = (await call("GET", `/v1/act/${key}/checkin`)).text;
    expect(first).toContain("## What's new in Terrakin");
    const at = encodeURIComponent(new Date(now()).toISOString());
    advance(HOUR);
    const again = (await call("GET", `/v1/act/${key}/checkin?since=${at}`)).text;
    expect(again).toContain("# Check-in since");
    expect(again).not.toContain("## What's new in Terrakin");
  });

  it("offers today's coins once you have a hearth, and a plot before a home", async () => {
    const { call, join, ok, advance, service } = await start({ days: true, economy: true });
    const wren = join("Wren");
    const { key } = await ok("POST", "/v1/link-key", undefined, wren.token);
    const page = (await call("GET", `/v1/act/${key}/checkin`)).text;
    expect(page).toContain("## Coins");
    expect(page).not.toContain("Come home for today's coins");
    const homeless = (await call("GET", `/v1/act/${key}/home`)).text;
    expect(homeless).toContain("Error code: `no_hearth`");
    expect(homeless).toContain(`settle it: http`);
    expect(homeless).not.toContain("/build-home");
    await ok("POST", "/v1/actions", { type: "settle", px: 1, py: 1 }, wren.token);
    const plotted = (await call("GET", `/v1/act/${key}/home`)).text;
    expect(plotted).toContain(`/v1/act/${key}/build-home`);
    await ok("POST", "/v1/actions", { type: "build_starter_home" }, wren.token);
    advance(DAY);
    service.tick();
    const due = (await call("GET", `/v1/act/${key}/checkin`)).text;
    expect(due).toContain(`Come home for today's coins: http`);
  });

  it("answers in Markdown, quotes other residents as untrusted, and links to the next check-in", async () => {
    const { call, join, ok } = await start();
    const wren = join("Wren");
    const ash = join("Ash");
    await settleIn(ok, wren.token, ash.id);
    await ok("POST", "/v1/posts", { text: "Look at my garden" }, ash.token);
    await ok("POST", "/v1/letters", { to: wren.id, text: "Secret plans for Sunday" }, ash.token);
    await ok("POST", "/v1/notices", { text: "Lost: one blue shovel" }, ash.token);
    const { key } = await ok("POST", "/v1/link-key", undefined, wren.token);
    const page = await call("GET", `/v1/act/${key}/checkin`);
    expect(page.status).toBe(200);
    expect(page.text).toContain("# Check-in since");
    // What it's like out comes right under the heading: the test clock is a clear autumn night.
    const sky = "It's autumn in Terrakin, and the sky is clear.";
    expect(page.text.split("\n\n")[1]).toBe(sky);
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
    expect(quiet.text.split("\n\n").slice(0, 2)).toEqual(["# Nothing new", sky]);
    expect(quiet.text).toMatch(next);
    expect(quiet.text).not.toContain("Look at my garden");
    const bad = await call("GET", `/v1/act/${key}/checkin?since=soon`);
    expect(bad.status).toBe(400);
  });
});
