import { readFileSync } from "node:fs";
import type { ServerMessage, WorldEvent as WireEvent } from "@terrakin/protocol";
import {
  CROPS,
  EARNED_WEAR,
  EXCLUSIVE_WEAR,
  FIND_KINDS,
  FISH_KINDS,
  firstSkill,
  levelOf,
  PROGRESS,
  UNLOCKS,
  WEAR_ITEMS,
  type WorldConfig,
  type WorldEvent,
} from "@terrakin/sim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, TEST_OPEN_LEVELS_PATH } from "./app";
import { eventWords } from "./events";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import {
  type Cleanup,
  jsonCaller,
  listenOnFreePort,
  recordTelemetry,
  responseChecker,
} from "./test-support";
import { DAY_MS, WorldService } from "./world-service";
import { eventsFor, publicEvents, toWire } from "./world-wire";

/**
 * Levels and skills (RFC 0029) over HTTP: nothing of them in a world that never opened them, the
 * switch and its one-time credit from the collection book, points that reach only their resident,
 * levels on profiles without points, `GET /v1/progress`, the check-in, the level notice, titles and
 * earned wear, and Hosting points for an event's counted guests.
 */

// 3x3 plots of 8 tiles. Settling plot (0, 0) and building the starter home leaves you on the
// hearth at (3, 3), inside a hut from (1, 1) to (5, 5).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
// What the server reported as it went: a refused `credit_event` shows here, and nowhere else.
const telemetry = recordTelemetry();
beforeEach(telemetry.start);
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  telemetry.stop();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

/**
 * The world on Tuesday 6 October 2026, 09:00 UTC, with coins, things, and presence, and levels
 * closed until a test opens them. A boot after another passes the same `store` and `sql`.
 */
async function start(
  options: {
    store?: MemoryStore;
    sql?: ReturnType<typeof nodeSql>;
    levels?: boolean;
    testClock?: boolean;
    at?: number;
    /** Runs on the social layer before the world is wired to it, to make a boot's read fail. */
    beforeWire?: (social: SocialService) => void;
  } = {},
) {
  let now = options.at ?? Date.UTC(2026, 9, 6, 9);
  const store = options.store ?? new MemoryStore();
  const service = new WorldService({
    store,
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    finds: true,
    presence: true,
    levels: options.levels ?? false,
  });
  const sql = options.sql ?? nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    residentAgeDays: (id) => service.residentAgeDays(id),
    credits: (since) => service.credits(since),
    event: (id) => eventWords(service.state, id),
  });
  options.beforeWire?.(social);
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    ...(options.testClock ? { testClock: { advanceDay: () => service.state.day ?? null } } : {}),
  });
  if (!options.sql) cleanups.push(() => sql.close());
  const base = await listenOnFreePort(server, cleanups);
  const call = jsonCaller(base);
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  async function settler(name: string, px: number, py: number, kind: "human" | "agent" = "agent") {
    const made = service.createSession({ name, kind });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    expect(await act(made.token, { type: "settle", px, py })).toMatchObject({ ok: true });
    expect(await act(made.token, { type: "build_starter_home" })).toMatchObject({ ok: true });
    return { id: made.residentId, token: made.token, px, py };
  }
  /** Move the clock on, then do what the minute sweep does, in its order. */
  const later = (ms: number) => {
    now += ms;
    service.tick();
    service.sweepEvents();
    service.sweepIdle();
  };
  /** Everything a resident's socket would be sent. */
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WireEvent[];
  };
  /** A workbench beside the hearth, wood for two things, and what making `recipe` answers. */
  const bench = async (r: { id: string; token: string; px: number; py: number }) => {
    const tile = { x: r.px * 8 + 4, y: r.py * 8 + 3 };
    expect(service.testGrant(r.id, undefined, { wood: 6 })).toMatchObject({ ok: true });
    expect(await act(r.token, { type: "place", ...tile, block: "workbench" })).toMatchObject({
      ok: true,
    });
    return (recipe: string) => act(r.token, { type: "craft", recipe, ...tile });
  };
  const open = () => service.testOpenLevels();
  const logged = (type: string) => store.log.filter((input) => input.command.type === type);
  service.tick();
  return {
    base,
    call,
    act,
    settler,
    later,
    listen,
    bench,
    open,
    logged,
    service,
    social,
    store,
    sql,
    now: () => now,
  };
}

type T = Awaited<ReturnType<typeof start>>;

const types = (events: readonly { type: string }[]) => events.map((e) => e.type);

/** Every key in a JSON value, at any depth. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysIn(v, found);
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      found.add(key);
      keysIn(v, found);
    }
  }
  return found;
}

describe("a world that never opened levels", () => {
  it("isn't switched on by any switch terrakin.org sets, and neither adapter asks for levels", () => {
    let now = Date.UTC(2026, 9, 9, 12);
    const store = new MemoryStore();
    const service = new WorldService({
      store,
      now: () => now,
      days: true,
      economy: true,
      items: true,
      gifts: true,
      plotPickups: true,
      finds: true,
      solidBuildings: true,
      tableSpots: true,
      shop: true,
      recipes: true,
      holidayPrices: true,
      market: true,
      bounties: true,
      presence: true,
    });
    for (let day = 0; day < 3; day++) {
      service.tick();
      now += DAY_MS;
    }
    const logged = store.log.map((input) => input.command.type);
    // The newest switch before it is on, so the table ran.
    expect(logged).toContain("open_recipes");
    expect(logged).not.toContain("open_levels");
    expect(logged).not.toContain("credit_event");
    expect(service.state.progress).toBeUndefined();
    // Turning levels on in production is its own change (RFC 0029, PR 6): until then neither the
    // Worker nor the Node server passes the option, and the Worker has no test route.
    const worker = readFileSync(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
    const node = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    for (const source of [worker, node]) expect(source).not.toMatch(/\blevels\s*:/);
    expect(worker).not.toMatch(/open-levels|testOpenLevels|open_levels/);
  });

  it("reads as it always did: no level field, step, event, or notice anywhere on the wire", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const heard = t.listen(bob.id);
    const make = await t.bench(ada);
    // The deeds that earn once levels are open: here they answer with what they always did.
    const chair = await make("chair");
    expect(types(chair.events)).toEqual(["inventory"]);
    expect(types((await make("fishing_rod")).events)).toEqual(["inventory"]);
    expect(types(heard())).not.toContain("level_reached");
    expect(t.service.state.progress).toBeUndefined();

    // Each read levels add to, key by key and in order, so a field that leaked in (or moved)
    // fails here by name.
    const world = (await t.call("GET", "/v1/world")).body;
    expect(Object.keys(world)).toEqual([
      "v",
      "seq",
      "hash",
      "time",
      "season",
      "weather",
      "timeOfDay",
      "config",
      "commons",
      "residents",
      "plots",
      "blocks",
      "day",
      "townHall",
      "pickups",
      "findsOpen",
    ]);
    const profile = (await t.call("GET", `/v1/residents/${ada.id}`, undefined, bob.token)).body;
    expect(Object.keys(profile.resident)).toEqual([
      "id",
      "trust",
      "name",
      "kind",
      "color",
      "shape",
      "note",
      "bio",
      "avatar",
      "online",
      "posts",
      "followers",
      "following",
      "friends",
      "followed",
      "praise",
      "karma",
      "votes",
      "collected",
      "home",
      "links",
    ]);
    const checkin = (await t.call("GET", "/v1/checkin", undefined, ada.token)).body;
    expect(Object.keys(checkin)).toEqual([
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
      "links",
    ]);
    expect(checkin.firstVisit).toEqual([
      "plot_name",
      "handle",
      "bio",
      "look",
      "garden",
      "post",
      "follow",
    ]);
    const steps = (await t.call("GET", "/v1/first-visit", undefined, ada.token)).body.steps;
    expect(steps.map((s: Json) => s.id)).toEqual([
      "plot",
      "plot_name",
      "home",
      "handle",
      "bio",
      "look",
      "garden",
      "post",
      "follow",
    ]);
    const notes = (await t.call("GET", "/v1/notifications", undefined, ada.token)).body;
    expect(notes.notifications).toEqual([]);
    // And nothing nested says a word about levels either.
    for (const [name, body] of Object.entries({ world, profile, checkin, steps, notes })) {
      const keys = keysIn(body);
      for (const key of ["level", "levels", "levelsOpen", "progress", "capped", "unlocks"]) {
        expect(keys.has(key), `${key} in ${name}`).toBe(false);
      }
    }
    expect(JSON.stringify(checkin.todo)).not.toMatch(/level|points|First visit: make/i);
    const link = (await t.call("POST", "/v1/link-key", {}, ada.token)).body.key;
    const page = (await t.call("GET", `/v1/act/${link}/checkin`)).text;
    expect(page).not.toMatch(/## Levels|Make a first thing/);

    // Asking for your own is the one new thing, and it says levels aren't open.
    const progress = (await t.call("GET", "/v1/progress", undefined, ada.token)).body;
    expect(progress).toMatchObject({ open: false, level: 1, points: 0, firsts: 0, titles: [] });
    // A title and an earned garment are nobody's yet.
    for (const action of [
      { type: "profile", title: "maker" },
      { type: "profile", wear: ["tool_belt"] },
    ]) {
      expect((await t.act(ada.token, action)).error.code).toBe("not_earned");
    }
  });
});

describe("opening levels", () => {
  it("waits for the collection book, then carries one first for each kind in it that counts", async () => {
    // With the option on, the world's own first tick has no book to read, so nothing opens.
    let now = Date.UTC(2026, 9, 6, 9);
    const bare = new WorldService({
      store: new MemoryStore(),
      config: CONFIG,
      now: () => now,
      days: true,
      items: true,
      levels: true,
    });
    now += DAY_MS;
    bare.tick();
    expect(bare.state.items).toBeDefined();
    expect(bare.state.progress).toBeUndefined();

    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const cy = await t.settler("Cy", 0, 2);
    // Ada grew, made, found, and caught things before levels; Bob was only given a lemon; Cy has
    // nothing a first counts (seeds, sugar, jars, and wood never do).
    t.service.testGrant(ada.id, undefined, { lemon: 2, acorn: 1, minnow: 1, wood: 3 });
    const make = await t.bench(ada);
    expect(await make("chair")).toMatchObject({ ok: true });
    t.service.testGrant(bob.id, undefined, { lemon: 1 });
    t.service.testGrant(cy.id, undefined, { wood: 2, stone: 2 });
    // Townsfolk never earn, and a book row can outlive its resident. The sim refuses a credit
    // that names either, so the credit leaves both out.
    const dee = await t.settler("Dee", 2, 2);
    t.service.testGrant(dee.id, undefined, { lemon: 1 });
    t.service.syncTownsfolk(new Set([dee.id]));
    t.sql.exec(
      "INSERT INTO collection (resident, shelf, kind, day) VALUES (?, 'thing', 'lemon', 1)",
      "r_00000000000000ff",
    );
    const adaHeard = t.listen(ada.id);
    const bobHeard = t.listen(bob.id);
    expect(t.open()).toMatchObject({ ok: true });

    // The credit is the book: every kind a resident has a day for and a first counts.
    const fromBook = (id: string) =>
      t.social.collection
        .view(id)
        .groups.flatMap((g) => g.kinds)
        .filter((k) => k.firstDay !== undefined && firstSkill(k.kind) !== undefined)
        .map((k) => k.kind)
        .sort();
    expect(fromBook(ada.id)).toEqual(["acorn", "chair", "lemon", "minnow"]);
    const [opened] = t.logged("open_levels");
    expect(opened?.command).toEqual({
      type: "open_levels",
      firsts: [ada, bob]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((r) => ({ resident: r.id, kinds: fromBook(r.id) })),
    });
    // 10 points a kind, in its skill: Ada is level 2, Bob has one first, Cy starts from nothing.
    const mine = async (token: string) =>
      (await t.call("GET", "/v1/progress", undefined, token)).body;
    expect(await mine(ada.token)).toMatchObject({ open: true, level: 2, points: 40, firsts: 4 });
    expect(await mine(bob.token)).toMatchObject({ level: 1, points: 10, firsts: 1 });
    expect(await mine(cy.token)).toMatchObject({ level: 1, points: 0, firsts: 0 });
    // Townsfolk have no level to show: not on a profile, and not in a check-in.
    expect((await t.call("GET", `/v1/residents/${dee.id}`)).body.resident.level).toBeUndefined();
    expect((await t.call("GET", `/v1/residents/${cy.id}`)).body.resident.level.level).toBe(1);
    const deeIn = (await t.call("GET", "/v1/checkin", undefined, dee.token)).body;
    expect(deeIn.progress).toBeUndefined();
    // Everyone hears that levels opened and that Ada reached level 2; her points are hers alone.
    expect(bobHeard()).toEqual([
      { type: "levels_opened" },
      { type: "level_reached", residentId: ada.id, skill: "foraging", level: 2 },
      { type: "level_reached", residentId: ada.id, level: 2 },
      {
        type: "progress",
        residentId: bob.id,
        skill: "growing",
        points: PROGRESS.first,
        firsts: ["lemon"],
        total: 10,
        today: 0,
      },
    ]);
    expect(types(adaHeard()).filter((type) => type === "progress")).toHaveLength(3);
    expect((await t.call("GET", "/v1/world")).body.levelsOpen).toBe(true);
    // Making a chair again is no first: the credit counted it.
    const again = await make("fishing_rod");
    expect(again.events.find((e: Json) => e.type === "progress")).toMatchObject({
      points: PROGRESS.craft + PROGRESS.first,
      firsts: ["fishing_rod"],
    });
    t.service.testGrant(ada.id, undefined, { wood: 3 });
    const chair = await make("chair");
    expect(chair.events.find((e: Json) => e.type === "progress")).toMatchObject({
      points: PROGRESS.craft,
    });
    // It's a one-time switch.
    expect(t.open()).toMatchObject({ ok: false, error: { code: "already_open" } });
    expect(t.logged("open_levels")).toHaveLength(1);
  });

  it("waits, with a report, while the book's read throws, and opens once it reads", () => {
    let now = Date.UTC(2026, 9, 6, 9);
    const store = new MemoryStore();
    const world = new WorldService({
      store,
      config: CONFIG,
      now: () => now,
      days: true,
      items: true,
      levels: true,
    });
    let away = true;
    world.levelFirsts = () => {
      if (away) throw new Error("the book is away");
      return [];
    };
    now += DAY_MS;
    world.tick();
    // The switch was due and asked: nothing is logged, and the failure is said once.
    expect(world.state.items).toBeDefined();
    expect(store.log.map((i) => i.command.type)).not.toContain("open_levels");
    expect(world.state.progress).toBeUndefined();
    expect(telemetry.reports).toEqual(["the book is away"]);
    away = false;
    world.tick();
    expect(store.log.filter((i) => i.command.type === "open_levels")).toHaveLength(1);
  });

  it("never opens from a book whose backfill failed: the switch waits for a boot that fills it", async () => {
    const before = await start();
    const ada = await before.settler("Ada", 0, 0);
    before.service.testGrant(ada.id, undefined, { pumpkin: 1 });
    // This boot has the option, but its backfill throws partway: the book may be missing rows.
    const t = await start({
      store: before.store,
      sql: before.sql,
      levels: true,
      at: before.now(),
      beforeWire: (social) => {
        social.collection.backfill = () => {
          throw new Error("the book is half filled");
        };
      },
    });
    t.later(DAY_MS);
    expect(t.logged("open_levels")).toEqual([]);
    expect(t.service.state.progress).toBeUndefined();
    expect(telemetry.reports).toEqual(["the book is half filled"]);
    // The next boot's backfill returns, and its first tick opens levels with the whole credit.
    const next = await start({ store: t.store, sql: t.sql, levels: true, at: t.now() });
    expect(next.logged("open_levels").map((i) => i.command)).toEqual([
      { type: "open_levels", firsts: [{ resident: ada.id, kinds: ["pumpkin"] }] },
    ]);
  });

  it("opens on the server's own tick once the option is on and the book is wired", async () => {
    // A world that has run without levels, as terrakin.org has.
    const before = await start();
    const ada = await before.settler("Ada", 0, 0);
    before.service.testGrant(ada.id, undefined, { pumpkin: 1 });
    expect(before.logged("open_levels")).toEqual([]);
    // The next boot has the option: its first tick with the book wired logs the switch, once.
    const t = await start({
      store: before.store,
      sql: before.sql,
      levels: true,
      at: before.now(),
    });
    expect(t.logged("open_levels").map((i) => i.command)).toEqual([
      { type: "open_levels", firsts: [{ resident: ada.id, kinds: ["pumpkin"] }] },
    ]);
    t.later(DAY_MS);
    expect(t.logged("open_levels")).toHaveLength(1);
  });

  it("has a test route that opens them now, only with the test clock and only from this machine", async () => {
    const off = await start();
    const post = (base: string) => fetch(base + TEST_OPEN_LEVELS_PATH, { method: "POST" });
    expect((await post(off.base)).status).toBe(404);
    expect(off.service.state.progress).toBeUndefined();

    const on = await start({ testClock: true });
    expect(await (await post(on.base)).json()).toEqual({ ok: true });
    expect(on.service.state.progress).toMatchObject({ points: {}, firsts: {} });
    const again = await post(on.base);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ ok: false, error: { code: "already_open" } });

    // A caller on the network gets a 404, test clock or not.
    const far = await start();
    const server = createApp({
      service: far.service,
      onResponse,
      testClock: { advanceDay: () => far.service.state.day ?? null },
    });
    const answer = await new Promise<{ status: number; body: string }>((done) => {
      let status = 0;
      const req = {
        method: "POST",
        url: TEST_OPEN_LEVELS_PATH,
        headers: { host: "localhost" },
        socket: { remoteAddress: "10.0.0.1" },
      };
      const res = {
        headersSent: false,
        writeHead: (code: number) => {
          status = code;
        },
        end: (body: string) => done({ status, body }),
      };
      server.emit("request", req, res);
    });
    expect(answer.status).toBe(404);
    expect(far.service.state.progress).toBeUndefined();
    // That the Worker has no such route is `town.test.ts`'s, with the other test routes.
  });
});

describe("points are private, and levels are public", () => {
  it("sends a progress event to its resident alone, and level_reached to everyone", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    expect(t.open()).toMatchObject({ ok: true });
    const adaHeard = t.listen(ada.id);
    const bobHeard = t.listen(bob.id);
    const make = await t.bench(ada);
    const first = await make("chair");
    // Ada's own answer carries her points, as the RFC promises an agent.
    expect(first.events.filter((e: Json) => e.type === "progress")).toEqual([
      {
        type: "progress",
        residentId: ada.id,
        skill: "making",
        points: PROGRESS.craft + PROGRESS.first,
        firsts: ["chair"],
        total: 12,
        today: 2,
      },
    ]);
    const second = await make("fishing_rod");
    expect(types(second.events).filter((type) => type !== "inventory")).toEqual([
      "progress",
      "level_reached",
      "level_reached",
    ]);
    // Bob's socket never gets her points: only that she reached Making 2 and level 2.
    expect(bobHeard().filter((e) => e.type === "progress")).toEqual([]);
    expect(bobHeard().filter((e) => e.type === "level_reached")).toEqual([
      { type: "level_reached", residentId: ada.id, skill: "making", level: 2 },
      { type: "level_reached", residentId: ada.id, level: 2 },
    ]);
    expect(adaHeard().filter((e) => e.type === "progress")).toHaveLength(2);
    // And no other read of Bob's carries them.
    const bobSees = [
      (await t.call("GET", `/v1/residents/${ada.id}`, undefined, bob.token)).text,
      (await t.call("GET", "/v1/world", undefined, bob.token)).text,
      (await t.call("GET", "/v1/checkin", undefined, bob.token)).text,
    ].join("\n");
    expect(bobSees).not.toContain('"progress":{"level":2');
    expect(bobSees).not.toContain(`"total":24`);
  });

  it("keeps another resident's points out of an answer, whoever's action earned them", () => {
    const events: WorldEvent[] = [
      { type: "progress", residentId: "r_ada", skill: "hosting", points: 6, total: 6, today: 6 },
      { type: "level_reached", residentId: "r_ada", skill: "hosting", level: 2 },
      { type: "event_credited", event: "e_1", guests: ["r_ada"] },
    ];
    const wire = toWire(events);
    // The guest list the server sent the sim stays on the server.
    expect(types(wire)).toEqual(["progress", "level_reached"]);
    // Bob paid the bounty that earned Ada her points: his answer and the broadcast leave them out.
    expect(types(eventsFor(wire, "r_bob"))).toEqual(["level_reached"]);
    expect(types(publicEvents(wire))).toEqual(["level_reached"]);
    expect(types(eventsFor(wire, "r_ada"))).toEqual(["progress", "level_reached"]);
    // An input that only earned points still moves everyone's seq, with nothing to draw.
    expect(publicEvents(toWire(events.slice(0, 1)))).toEqual([{ type: "quiet" }]);
  });

  it("shows a profile's level, skill levels, and title to anyone, and points to nobody else", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    expect(t.open()).toMatchObject({ ok: true });
    const make = await t.bench(ada);
    await make("chair");
    await make("fishing_rod");
    const level = {
      level: 2,
      skills: { growing: 1, making: 2, foraging: 1, hosting: 1, playing: 1 },
    };
    for (const token of [bob.token, undefined]) {
      const res = await t.call("GET", `/v1/residents/${ada.id}`, undefined, token);
      expect(res.body.resident.level).toEqual(level);
      expect(res.text).not.toMatch(/"(points|today|firsts|nextAt|cap)"/);
    }
    // Your own profile is the same public view: your points are in GET /v1/progress alone.
    const me = await t.call("GET", "/v1/me", undefined, ada.token);
    expect(me.body.resident.level).toEqual(level);
    expect(me.text).not.toMatch(/"(points|today|firsts|nextAt|cap)"/);

    // GET /v1/progress is the caller's own, always: there's nobody else's to ask for.
    expect((await t.call("GET", "/v1/progress")).status).toBe(401);
    const mine = (await t.call("GET", "/v1/progress", undefined, ada.token)).body;
    expect(mine).toEqual({
      open: true,
      level: 2,
      points: 24,
      nextAt: 60,
      skills: [
        { skill: "growing", level: 1, points: 0, nextAt: 20, today: 0, cap: PROGRESS.dailyCap },
        { skill: "making", level: 2, points: 24, nextAt: 60, today: 4, cap: PROGRESS.dailyCap },
        { skill: "foraging", level: 1, points: 0, nextAt: 20, today: 0, cap: PROGRESS.dailyCap },
        { skill: "hosting", level: 1, points: 0, nextAt: 20, today: 0, cap: PROGRESS.dailyCap },
        { skill: "playing", level: 1, points: 0, nextAt: 20, today: 0, cap: PROGRESS.dailyCap },
      ],
      firsts: 2,
      titles: [],
      wear: [],
      next: [
        { skill: "growing", level: UNLOCKS.title, unlocks: { title: "gardener" } },
        { skill: "making", level: UNLOCKS.title, unlocks: { title: "maker" } },
        { skill: "foraging", level: UNLOCKS.title, unlocks: { title: "forager" } },
        { skill: "hosting", level: UNLOCKS.title, unlocks: { title: "host" } },
        { skill: "playing", level: UNLOCKS.title, unlocks: { title: "player" } },
      ],
    });
    const bobs = (await t.call("GET", "/v1/progress", undefined, bob.token)).body;
    expect(bobs).toMatchObject({ level: 1, points: 0, firsts: 0 });
    // `?id=` and friends change nothing: the route has no parameters.
    const asked = await t.call("GET", `/v1/progress?id=${ada.id}`, undefined, bob.token);
    expect(asked.body.points).toBe(0);
  });
});

/** A world where Ada holds every crop, find, and fish before levels open, and Bob nothing. */
async function credited() {
  const t = await start();
  const ada = await t.settler("Ada", 0, 0);
  const bob = await t.settler("Bob", 2, 0);
  const stacks = Object.fromEntries([...CROPS, ...FIND_KINDS, ...FISH_KINDS].map((k) => [k, 1]));
  expect(t.service.testGrant(ada.id, undefined, stacks)).toMatchObject({ ok: true });
  expect(t.open()).toMatchObject({ ok: true });
  const growing = levelOf(CROPS.length * PROGRESS.first);
  const foraging = levelOf((FIND_KINDS.length + FISH_KINDS.length) * PROGRESS.first);
  // The catalog gives this test what it needs: a first title in Growing, a garment in Foraging.
  expect(growing).toBeGreaterThanOrEqual(UNLOCKS.title);
  expect(growing).toBeLessThan(UNLOCKS.wear);
  expect(foraging).toBeGreaterThanOrEqual(UNLOCKS.wear);
  expect(foraging).toBeLessThan(UNLOCKS.master);
  return { t, ada, bob, growing, foraging };
}

describe("a level-up", () => {
  it("makes one notice from Terrakin for the input, and a todo line for each level that unlocked something", async () => {
    const { t, ada, bob, growing, foraging } = await credited();
    const notes = (await t.call("GET", "/v1/notifications", undefined, ada.token)).body;
    const total = (CROPS.length + FIND_KINDS.length + FISH_KINDS.length) * PROGRESS.first;
    expect(notes.unread).toBe(1);
    expect(notes.notifications).toMatchObject([
      {
        type: "level_reached",
        system: true,
        actor: { id: "terrakin" },
        count: 1,
        postId: null,
        read: false,
        levels: [
          { skill: "growing", level: growing, unlocks: { title: "gardener" } },
          { skill: "foraging", level: foraging, unlocks: { title: "forager", wear: "field_vest" } },
          { level: levelOf(total) },
        ],
      },
    ]);
    // Bob levelled nowhere, so nobody told him anything.
    expect((await t.call("GET", "/v1/notifications", undefined, bob.token)).body.unread).toBe(0);

    const checkin = (await t.call("GET", "/v1/checkin", undefined, ada.token)).body;
    expect(checkin.progress).toEqual({ level: levelOf(total), today: {}, capped: [] });
    const lines = checkin.todo.filter((line: string) => line.startsWith("You reached"));
    expect(lines).toEqual([
      `You reached Growing ${growing}, so you can show the title Gardener ({"type": "profile", "title": "gardener"}). Tell your owner, and ask if they'd like you to.`,
      `You reached Foraging ${foraging}, so you can wear the field vest ({"type": "profile", "wear": [..., "field_vest"]}, with the rest of what you wear, since \`wear\` is your whole outfit) and show the title Forager ({"type": "profile", "title": "forager"}). Tell your owner, and ask if they'd like you to.`,
    ]);
    // A reader with only links hears it in words, with the link that puts the vest on over what
    // she already wears (a hat stays, since the vest is a top), and that a title needs the API.
    await t.act(ada.token, { type: "profile", wear: ["straw_hat", "apron"] });
    const key = (await t.call("POST", "/v1/link-key", {}, ada.token)).body.key;
    const page = (await t.call("GET", `/v1/act/${key}/checkin`)).text;
    expect(page).toContain("## Levels");
    expect(page).toContain(`You're level ${levelOf(total)}.`);
    expect(page).toContain(`you reached Growing ${growing} and Foraging ${foraging} and Level`);
    expect(page).toContain("the field vest to wear and the title Forager");
    expect(page).toContain(
      `- Foraging ${foraging} unlocked the field vest. If your owner would like you to wear it, with the rest of what you have on: ${t.base}/v1/act/${key}/look?wear=straw_hat,field_vest`,
    );
    expect(page).toContain(
      `- Growing ${growing} unlocked the title Gardener. Showing a title on your profile needs the API or the website: tell your owner.`,
    );
    const worn = await t.call("GET", `/v1/act/${key}/look?wear=straw_hat,field_vest`);
    expect(worn.status).toBe(200);
    expect(t.service.state.residents[ada.id]?.wear).toEqual(["straw_hat", "field_vest"]);

    // Once read, the lines go: they're news, not a standing reminder.
    const newest = notes.notifications[0].id;
    await t.call("POST", "/v1/notifications/read", { upTo: newest }, ada.token);
    const after = (await t.call("GET", "/v1/checkin", undefined, ada.token)).body;
    expect(after.todo.filter((line: string) => line.startsWith("You reached"))).toEqual([]);

    // A level that unlocks nothing is still one notice, with no line of its own.
    const make = await t.bench(bob);
    await make("chair");
    await make("fishing_rod");
    const bobs = (await t.call("GET", "/v1/notifications", undefined, bob.token)).body;
    expect(bobs.notifications).toHaveLength(1);
    expect(bobs.notifications[0].levels).toEqual([{ skill: "making", level: 2 }, { level: 2 }]);
    const bobIn = (await t.call("GET", "/v1/checkin", undefined, bob.token)).body;
    expect(bobIn.todo.filter((line: string) => line.startsWith("You reached"))).toEqual([]);
    expect(bobIn.progress).toEqual({ level: 2, today: { making: 4 }, capped: [] });
  });

  it("lets you show a title and wear a garment you've reached, and refuses the rest as not_earned", async () => {
    const { t, ada, bob } = await credited();
    const heard = t.listen(bob.id);
    const mine = (await t.call("GET", "/v1/progress", undefined, ada.token)).body;
    expect(mine.titles).toEqual(["gardener", "forager"]);
    expect(mine.wear).toEqual(["field_vest"]);

    // A title from a skill she's reached shows on her profile, for everyone.
    const titled = await t.act(ada.token, { type: "profile", title: "forager" });
    expect(titled.events).toEqual([
      { type: "title_changed", residentId: ada.id, title: "forager" },
    ]);
    expect(heard().at(-1)).toEqual({ type: "title_changed", residentId: ada.id, title: "forager" });
    const seen = (await t.call("GET", `/v1/residents/${ada.id}`, undefined, bob.token)).body;
    expect(seen.resident.level.title).toBe("forager");
    expect((await t.call("GET", "/v1/progress", undefined, ada.token)).body.title).toBe("forager");
    // One she hasn't reached, and one from another skill's second step, are refused.
    for (const title of ["maker", "master_forager"]) {
      const refused = await t.act(ada.token, { type: "profile", title });
      expect(refused, title).toMatchObject({ ok: false, error: { code: "not_earned" } });
    }
    // Bob has reached nothing, whatever Ada has.
    const bobs = await t.act(bob.token, { type: "profile", title: "forager" });
    expect(bobs.error.code).toBe("not_earned");
    // `null` shows none again.
    await t.act(ada.token, { type: "profile", title: null });
    const cleared = (await t.call("GET", `/v1/residents/${ada.id}`)).body.resident.level;
    expect(cleared.title).toBeUndefined();

    // The garment her Foraging earned goes on like any wear, and takes a color of its own.
    const worn = await t.act(ada.token, {
      type: "profile",
      wear: ["field_vest", "boots"],
      wearStyle: { field_vest: { color: "plum" } },
    });
    expect(worn).toMatchObject({ ok: true });
    const look = (await t.call("GET", `/v1/residents/${ada.id}`)).body.resident.look;
    expect(look).toMatchObject({
      wear: ["field_vest", "boots"],
      wearStyle: { field_vest: { color: "plum" } },
    });
    expect((await t.call("GET", "/v1/world")).body.residents[0].wear).toEqual([
      "field_vest",
      "boots",
    ]);
    // Growing's hat takes Growing 5, and Bob's vest takes his own Foraging.
    expect((await t.act(ada.token, { type: "profile", wear: ["sun_hat"] })).error.code).toBe(
      "not_earned",
    );
    expect((await t.act(bob.token, { type: "profile", wear: ["field_vest"] })).error.code).toBe(
      "not_earned",
    );
  });

  it("keeps earned garments out of the collection book, worn or not", async () => {
    const { t, ada } = await credited();
    const before = t.social.collection.view(ada.id);
    await t.act(ada.token, { type: "profile", wear: ["field_vest", "boots"] });
    const book = t.social.collection.view(ada.id);
    const wear = book.groups.find((g) => g.family === "wear");
    // Boots joined the book, and the vest she's wearing didn't.
    expect(book.count).toBe(before.count + 1);
    expect(wear?.kinds.find((k) => k.kind === "boots")?.firstDay).toBeDefined();
    // So "Full wardrobe" is still every piece the shop and the free rack have, and no more: no
    // earned garment is a row in the book, and the book is as long as it was before they existed.
    const rows = wear?.kinds.map((k) => k.kind) ?? [];
    for (const item of EARNED_WEAR) expect(rows, item).not.toContain(item);
    expect(wear?.total).toBe(WEAR_ITEMS.length - EARNED_WEAR.length - EXCLUSIVE_WEAR.length);
  });
});

describe("the first visit, once levels are open", () => {
  it("gains a step that earns a first: a newcomer's own, and a suggestion for who was here before", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    // Ada joined yesterday; levels open today; Bob joins after.
    t.later(DAY_MS);
    expect(t.open()).toMatchObject({ ok: true });
    const bob = await t.settler("Bob", 2, 0);
    const line =
      'First visit: make a first thing, which earns your first points (GET /v1/progress): pick up 3 fallen branches ({"type": "gather"} takes everything within reach; `pickups` in GET /v1/world shows where `wood` lies), place a workbench by your hearth ({"type": "place", "x": <x>, "y": <y>, "block": "workbench"}), then {"type": "craft", "recipe": "chair", "x": <x>, "y": <y>}. A second first, like a fishing rod from 3 more wood, takes you to level 2.';

    const bobIn = (await t.call("GET", "/v1/checkin", undefined, bob.token)).body;
    expect(bobIn.firstVisit).toEqual([
      "plot_name",
      "handle",
      "bio",
      "look",
      "garden",
      "make",
      "post",
      "follow",
    ]);
    expect(bobIn.todo).toContain(line);
    const bobSteps = (await t.call("GET", "/v1/first-visit", undefined, bob.token)).body.steps;
    expect(bobSteps.find((s: Json) => s.id === "make")).toEqual({ id: "make", done: false });
    const key = (await t.call("POST", "/v1/link-key", {}, bob.token)).body.key;
    const page = (await t.call("GET", `/v1/act/${key}/checkin`)).text;
    expect(page).toContain(`/v1/act/${key}/craft?recipe=chair`);

    // For Ada it was added after she joined: never in her first visit, marked `later`.
    const adaIn = (await t.call("GET", "/v1/checkin", undefined, ada.token)).body;
    expect(adaIn.firstVisit).not.toContain("make");
    expect(adaIn.todo).not.toContain(line);
    const adaSteps = (await t.call("GET", "/v1/first-visit", undefined, ada.token)).body.steps;
    expect(adaSteps.find((s: Json) => s.id === "make")).toEqual({
      id: "make",
      done: false,
      later: true,
    });

    // Making something does it, and the two firsts the line promises reach level 2.
    const make = await t.bench(bob);
    await make("chair");
    const done = (await t.call("GET", "/v1/checkin", undefined, bob.token)).body;
    expect(done.firstVisit).not.toContain("make");
    expect(done.progress.level).toBe(1);
    await make("fishing_rod");
    expect((await t.call("GET", "/v1/checkin", undefined, bob.token)).body.progress.level).toBe(2);
  });
});

describe("Hosting points for an event", () => {
  /** Ada, Bob, and Cy, settled three days ago and active today, so each may host and count. */
  async function hosts(t: T) {
    const ada = await t.settler("Ada", 0, 0, "human");
    const bob = await t.settler("Bob", 2, 0);
    const cy = await t.settler("Cy", 0, 2);
    t.later(3 * DAY_MS);
    for (const r of [ada, bob, cy]) {
      expect(await t.act(r.token, { type: "move", dir: "n" })).toMatchObject({ ok: true });
    }
    return { ada, bob, cy };
  }
  /** Ada's hour at her plot from noon today, with Bob there the whole time and Cy only at the start. */
  async function hold(t: T, ada: { token: string }, bob: { token: string }, cy: { token: string }) {
    const noon = Math.floor(t.now() / DAY_MS) * DAY_MS + 12 * HOUR;
    const scheduled = await t.act(ada.token, {
      type: "schedule_event",
      kind: "listening",
      title: "Sunday records",
      text: "Bring a song.",
      px: 0,
      py: 0,
      startsAt: new Date(noon).toISOString(),
      minutes: 60,
    });
    expect(scheduled).toMatchObject({ ok: true });
    const id = "e_1";
    t.later(noon + MINUTE - t.now());
    for (const r of [bob, cy]) {
      expect(await t.act(r.token, { type: "join_event", event: id })).toMatchObject({ ok: true });
    }
    for (let i = 0; i < 11; i++) {
      t.later(5 * MINUTE);
      expect(await t.act(bob.token, { type: "join_event", event: id })).toMatchObject({ ok: true });
    }
    t.later(5 * MINUTE);
    return id;
  }

  it("logs credit_event once for an event that ended after the switch, with the guests the hosting record counted", async () => {
    const t = await start();
    const { ada, bob, cy } = await hosts(t);
    expect(t.open()).toMatchObject({ ok: true });
    // The day after levels opened, so a later boot's catch-up looks at this event too.
    t.later(DAY_MS);
    for (const r of [ada, bob, cy]) await t.act(r.token, { type: "move", dir: "s" });
    const adaHeard = t.listen(ada.id);
    const cyHeard = t.listen(cy.id);
    const id = await hold(t, ada, bob, cy);
    expect(t.service.state.events?.list[0]).toMatchObject({ status: "ended", credited: true });

    // The same guests the record counted: Bob stayed, Cy dropped away.
    expect(t.social.events.countedGuests(id)).toEqual([bob.id]);
    expect(t.logged("credit_event").map((i) => i.command)).toEqual([
      { type: "credit_event", event: id, guests: [bob.id] },
    ]);
    // It came right after the event's own end, as an input of its own.
    const order = t.store.log.map((i) => i.command.type);
    expect(order.indexOf("credit_event")).toBe(order.indexOf("event_end") + 1);

    const mine = async (token: string) =>
      (await t.call("GET", "/v1/progress", undefined, token)).body.skills[3];
    expect(await mine(ada.token)).toMatchObject({ skill: "hosting", points: PROGRESS.guest });
    expect(await mine(bob.token)).toMatchObject({ skill: "hosting", points: PROGRESS.attend });
    expect(await mine(cy.token)).toMatchObject({ skill: "hosting", points: 0 });
    // The host hears her own points, and nobody the guest list.
    expect(adaHeard().filter((e) => e.type === "progress")).toHaveLength(1);
    expect(types(cyHeard())).not.toContain("progress");
    expect(types(cyHeard())).not.toContain("event_credited");

    // Nothing credits it again, or tries to: not the next ticks, and not the next boot's catch-up.
    t.later(DAY_MS);
    const again = await start({ store: t.store, sql: t.sql, at: t.now() });
    again.later(MINUTE);
    expect(again.logged("credit_event")).toHaveLength(1);
    expect(telemetry.reports).toEqual([]);
  });

  it("credits nothing for an event that ended before levels opened, then or after a restart", async () => {
    const t = await start();
    const { ada, bob, cy } = await hosts(t);
    const id = await hold(t, ada, bob, cy);
    expect(t.social.events.countedGuests(id)).toEqual([bob.id]);
    expect(t.logged("credit_event")).toEqual([]);
    // Levels open later the same day: the event is over, and stays uncredited.
    expect(t.open()).toMatchObject({ ok: true });
    t.later(HOUR);
    expect(t.logged("credit_event")).toEqual([]);
    const again = await start({ store: t.store, sql: t.sql, at: t.now() });
    again.later(DAY_MS);
    expect(again.logged("credit_event")).toEqual([]);
    expect(again.service.state.events?.list[0]?.credited).toBeUndefined();
    expect(again.service.state.progress?.points).toEqual({});
    // The server never asked: the sim would have refused, and that refusal would be reported.
    expect(telemetry.reports).toEqual([]);
  });

  it("credits an event whose record a crash cut off, once the next boot has written it", async () => {
    const t = await start();
    const { ada, bob, cy } = await hosts(t);
    expect(t.open()).toMatchObject({ ok: true });
    // The day after levels opened, so the event's day alone says it ended after the switch.
    t.later(DAY_MS);
    for (const r of [ada, bob, cy]) await t.act(r.token, { type: "move", dir: "s" });
    // The hosting record fails as the event ends: the world moved on, and nobody was counted.
    const record = t.social.events.recordEnded.bind(t.social.events);
    t.social.events.recordEnded = () => {
      throw new Error("the social database is away");
    };
    const id = await hold(t, ada, bob, cy);
    t.social.events.recordEnded = record;
    expect(t.service.state.events?.list[0]?.status).toBe("ended");
    expect(t.social.events.countedGuests(id)).toBeUndefined();
    expect(t.logged("credit_event")).toEqual([]);
    // The next boot records the event, then credits it from that record.
    const again = await start({ store: t.store, sql: t.sql, at: t.now() });
    expect(again.logged("credit_event").map((i) => i.command)).toEqual([
      { type: "credit_event", event: id, guests: [bob.id] },
    ]);
    expect(again.service.state.events?.list[0]?.credited).toBe(true);
  });

  it.each([
    {
      who: "who joined the host's household since",
      change: (t: T, ada: { id: string }, bob: { id: string }) =>
        t.service.addOwnerPair(bob.id, ada.id),
      record: undefined,
      guests: 0,
    },
    {
      who: "who became townsfolk since",
      change: (t: T, _ada: { id: string }, bob: { id: string }) =>
        t.service.syncTownsfolk(new Set([bob.id])),
      record: undefined,
      guests: 0,
    },
    {
      // Cy left early: the sim's samples dropped her, whatever a record says.
      who: "the event's own samples never saw stay",
      change: () => {},
      record: (bob: { id: string }, cy: { id: string }) => [bob.id, cy.id],
      guests: 1,
    },
  ])("leaves out a counted guest $who, so the rest of the list still counts", async (c) => {
    const t = await start();
    const { ada, bob, cy } = await hosts(t);
    expect(t.open()).toMatchObject({ ok: true });
    // The record counts Bob, but the credit waits: nothing can read the record as the event ends.
    const read = t.service.countedGuests;
    t.service.countedGuests = () => undefined;
    const id = await hold(t, ada, bob, cy);
    expect(t.social.events.countedGuests(id)).toEqual([bob.id]);
    expect(t.logged("credit_event")).toEqual([]);
    // Meanwhile something changed that the sim never credits.
    c.change(t, ada, bob);
    const record = c.record;
    t.service.countedGuests = record ? () => record(bob, cy) : read;
    t.later(MINUTE);
    // A list with that guest in it would be refused whole, and reported. Without them it's taken,
    // and the event is done.
    expect(t.logged("credit_event").map((i) => i.command)).toEqual([
      { type: "credit_event", event: id, guests: c.guests ? [bob.id] : [] },
    ]);
    expect(t.service.state.events?.list[0]?.credited).toBe(true);
    expect(Object.keys(t.service.state.progress?.points ?? {}).sort()).toEqual(
      c.guests ? [ada.id, bob.id].sort() : [],
    );
    expect(telemetry.reports).toEqual([]);
  });

  it("keeps an event whose credit threw, the day levels opened too, and credits it on a later sweep", async () => {
    const t = await start();
    const { ada, bob, cy } = await hosts(t);
    expect(t.open()).toMatchObject({ ok: true });
    // The hosting record can't be read as the event ends, on the very day levels opened.
    const read = t.service.countedGuests;
    t.service.countedGuests = () => {
      throw new Error("the social database is away");
    };
    // Nothing escapes the input that ended the event: it's committed, and the sweep carries on.
    const id = await hold(t, ada, bob, cy);
    expect(t.service.state.events?.list[0]).toMatchObject({ id, status: "ended" });
    expect(t.service.state.events?.list[0]?.credited).toBeUndefined();
    expect(t.logged("credit_event")).toEqual([]);
    expect(new Set(telemetry.reports)).toEqual(new Set(["the social database is away"]));
    // The record reads again: the next minute sweep credits the event, with no restart.
    t.service.countedGuests = read;
    telemetry.reports.length = 0;
    t.later(MINUTE);
    expect(t.logged("credit_event").map((i) => i.command)).toEqual([
      { type: "credit_event", event: id, guests: [bob.id] },
    ]);
    expect(t.service.state.events?.list[0]?.credited).toBe(true);
    // Once credited it isn't asked about again.
    let reads = 0;
    t.service.countedGuests = (event) => {
      reads += 1;
      return read?.(event);
    };
    t.later(MINUTE);
    expect(reads).toBe(0);
    expect(t.logged("credit_event")).toHaveLength(1);
    expect(telemetry.reports).toEqual([]);
  });
});
