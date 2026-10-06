import type { ServerMessage, WorldEvent } from "@terrakin/protocol";
import { apply, createWorld, TOWN_ACTOR, type WorldConfig, type WorldState } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { countGuests, eventWords } from "./events";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { supplyHolds } from "./snapshots";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { TOWN_EVENTS, type TownEvent } from "./town-events";
import { DAY_MS, WorldService } from "./world-service";

/**
 * Hosted events (RFC 0010) end to end over HTTP: the runner on the server's clock, attendance for
 * guests on a socket or calling over REST, the town's own calendar logged once, words kept off the
 * socket, going, the check-in, the hosting record, and staff calling one off.
 */

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
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

/** The world on Tuesday 6 October 2026, 09:00 UTC, with presence coming from acting. */
async function start(
  options: { store?: MemoryStore; townEvents?: readonly TownEvent[]; at?: number } = {},
) {
  let now = options.at ?? Date.UTC(2026, 9, 6, 9);
  const store = options.store ?? new MemoryStore();
  const service = new WorldService({
    store,
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    presence: true,
    townEvents: options.townEvents ?? [],
  });
  const sql = nodeSql();
  const maintainers = new Set<string>();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    residentAgeDays: (id) => service.residentAgeDays(id),
    credits: (since) => service.credits(since),
    event: (id) => eventWords(service.state, id),
    maintainers,
  });
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  cleanups.push(() => sql.close());
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  async function resident(name: string, kind: "human" | "agent" = "agent") {
    const made = service.createSession({ name, kind });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  }
  async function settler(name: string, px: number, py: number, kind?: "human" | "agent") {
    const r = await resident(name, kind);
    expect(await act(r.token, { type: "settle", px, py })).toMatchObject({ ok: true });
    expect(await act(r.token, { type: "build_starter_home" })).toMatchObject({ ok: true });
    return r;
  }
  /** Move the clock on, then do what the minute sweep does, in its order. */
  const later = (ms: number) => {
    now += ms;
    service.tick();
    service.sweepEvents();
    service.sweepIdle();
  };
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WorldEvent[];
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    call,
    act,
    resident,
    settler,
    later,
    listen,
    iso,
    service,
    social,
    store,
    maintainers,
    now: () => now,
  };
}

type T = Awaited<ReturnType<typeof start>>;

/** Ada, Bob, and Cy, settled three days ago and active today, so each may host. */
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

/** Today at `hour`:`minute` UTC, in ms. */
const todayAt = (t: T, hour: number, minute = 0) =>
  Math.floor(t.now() / DAY_MS) * DAY_MS + hour * HOUR + minute * MINUTE;

const listening = (t: T, startsAt: number, fields: Json = {}) => ({
  type: "schedule_event",
  kind: "listening",
  title: "Sunday records",
  text: "Bring a song.",
  px: 0,
  py: 0,
  startsAt: t.iso(startsAt),
  minutes: 60,
  ...fields,
});

describe("an event on the server's clock", () => {
  it("starts on time, samples on the sweep, and counts a REST guest who keeps calling", async () => {
    const t = await start();
    const { ada, bob, cy } = await hosts(t);
    const noon = todayAt(t, 12);
    expect(await t.act(ada.token, listening(t, noon))).toMatchObject({ ok: true });
    t.later(noon + MINUTE - t.now());
    expect(t.service.state.events?.list[0]?.status).toBe("live");
    // Bob and Cy go over REST; only Bob keeps reading the event while he's there.
    for (const r of [bob, cy]) {
      expect(await t.act(r.token, { type: "join_event", event: "e_1" })).toMatchObject({
        ok: true,
      });
    }
    for (let i = 0; i < 11; i++) {
      t.later(5 * MINUTE);
      expect((await t.call("GET", "/v1/events/e_1", undefined, bob.token)).status).toBe(200);
    }
    expect(t.service.state.events?.list[0]).toMatchObject({ ticks: 11, slot: 11 });
    expect(t.service.state.residents[cy.id]?.online).toBe(false);
    t.later(5 * MINUTE);
    const ended = (await t.call("GET", "/v1/events/e_1")).body.event;
    expect(ended).toMatchObject({ status: "ended", ticks: 11 });
    expect(ended.attended.map((a: Json) => a.id)).toEqual([bob.id]);
    // Ada's record: one event, one guest, an AI.
    const profile = (await t.call("GET", `/v1/residents/${ada.id}`)).body.resident;
    expect(profile.hosting).toEqual({ events: 1, guests: 1, people: 0, agents: 1 });
  });

  it("starts and ends at once an event the server slept through, and never makes up a sample", async () => {
    const t = await start();
    const { ada, bob } = await hosts(t);
    const noon = todayAt(t, 12);
    expect(await t.act(ada.token, listening(t, noon))).toMatchObject({ ok: true });
    expect(await t.act(ada.token, listening(t, noon + 2 * HOUR))).toMatchObject({ ok: true });
    t.later(noon + 2 * HOUR + 20 * MINUTE - t.now());
    const [first, second] = t.service.state.events?.list ?? [];
    expect(first).toMatchObject({ status: "ended", ticks: 0, attended: [] });
    expect(second).toMatchObject({ status: "live", ticks: 1, slot: 4 });
    expect(await t.act(bob.token, { type: "join_event", event: "e_2" })).toMatchObject({
      ok: true,
    });
    t.later(MINUTE);
    expect(second).toMatchObject({ ticks: 1, slot: 4 });
    t.later(5 * MINUTE);
    expect(second).toMatchObject({ ticks: 2, slot: 5 });
  });

  it("answers join_event from a guest already there without logging anything", async () => {
    const t = await start();
    const { ada, bob } = await hosts(t);
    expect(await t.act(ada.token, listening(t, todayAt(t, 12)))).toMatchObject({ ok: true });
    t.later(todayAt(t, 12) - t.now());
    expect(await t.act(bob.token, { type: "join_event", event: "e_1" })).toMatchObject({
      ok: true,
    });
    const seq = t.service.state.seq;
    expect(await t.act(bob.token, { type: "join_event", event: "e_1" })).toEqual({
      ok: true,
      seq,
      events: [],
    });
    expect(t.store.log).toHaveLength(seq);
  });
});

describe("the town's calendar", () => {
  it("logs the harvest night once, when it comes inside the booking window, across restarts", async () => {
    const harvest = TOWN_EVENTS.find((e) => e.key === "harvest-night-2026");
    expect(harvest).toMatchObject({ startsAt: "2026-10-31T18:00:00Z", minutes: 540 });
    const store = new MemoryStore();
    const t = await start({ store, townEvents: TOWN_EVENTS });
    const juniper = await t.resident("Juniper");
    const pip = await t.resident("Pip");
    for (const [r, handle] of [
      [juniper, "juniper"],
      [pip, "clem"],
    ] as const) {
      expect((await t.call("PUT", "/v1/profile", { handle }, r.token)).status).toBe(200);
    }
    // Juniper is townsfolk. Pip holds the handle "clem" but isn't, so they're no face of it.
    t.service.syncTownsfolk(new Set([juniper.id]));
    const logged = () => store.log.filter((i) => i.command.type === "schedule_town_event");
    t.later(Date.UTC(2026, 9, 16, 23, 59) - t.now());
    expect(logged()).toEqual([]);
    t.later(2 * MINUTE);
    t.later(MINUTE);
    expect(logged()).toEqual([
      {
        actor: TOWN_ACTOR,
        command: {
          type: "schedule_town_event",
          key: "harvest-night-2026",
          kind: "gathering",
          title: "Harvest night",
          text: harvest?.text,
          startsAt: Date.UTC(2026, 9, 31, 18),
          minutes: 540,
          faces: [juniper.id],
        },
      },
    ]);
    const board = (await t.call("GET", "/v1/town")).body.events;
    expect(board.upcoming).toMatchObject([
      { title: "Harvest night", town: true, host: null, place: { commons: true } },
    ]);
    // A restart replays the log, and the sweep still logs it once.
    const again = new WorldService({
      store,
      config: CONFIG,
      now: t.now,
      days: true,
      economy: true,
      presence: true,
      townEvents: TOWN_EVENTS,
    });
    again.sweepEvents();
    expect(logged()).toHaveLength(1);
    // It runs on its evening, and the Commons is the town's then.
    expect(again.nextEventWake()).toBe(Date.UTC(2026, 9, 31, 18));
  });
});

describe("scheduling over the API", () => {
  it("wants an hour's notice and a whole minute, and keeps the words off the socket", async () => {
    const t = await start();
    const { ada, bob } = await hosts(t);
    const heard = t.listen(bob.id);
    const soon = t.now() + 30 * MINUTE;
    expect(await t.act(ada.token, listening(t, soon - (soon % MINUTE)))).toMatchObject({
      ok: false,
      error: { code: "invalid_event" },
    });
    expect(await t.act(ada.token, listening(t, todayAt(t, 12) + 30_000))).toMatchObject({
      ok: false,
      error: { code: "invalid_event" },
    });
    expect(await t.act(ada.token, listening(t, todayAt(t, 12)))).toMatchObject({ ok: true });
    const scheduled = heard().find((e) => e.type === "event_scheduled");
    expect(scheduled).toMatchObject({ event: "e_1", host: ada.id, px: 0, py: 0 });
    expect(JSON.stringify(heard())).not.toContain("Sunday records");
    const world = (await t.call("GET", "/v1/world")).body;
    expect(world.events).toEqual([
      {
        id: "e_1",
        host: ada.id,
        px: 0,
        py: 0,
        status: "scheduled",
        startsAt: todayAt(t, 12),
        minutes: 60,
      },
    ]);
    const listed = (await t.call("GET", "/v1/events", undefined, bob.token)).body;
    expect(listed.upcoming).toMatchObject([
      { id: "e_1", trust: "untrusted", title: "Sunday records", text: "Bring a song." },
    ]);
    // Samples stay on the server: the socket only keeps counting.
    t.later(todayAt(t, 12) + 6 * MINUTE - t.now());
    expect(heard().some((e) => (e.type as string) === "event_ticked")).toBe(false);
    expect(t.service.state.events?.list[0]?.ticks).toBe(1);
  });
});

describe("going", () => {
  it("is a public count, never across a block, and brings the event to the check-in by id", async () => {
    const t = await start();
    const { ada, bob, cy } = await hosts(t);
    const noon = todayAt(t, 12);
    expect(await t.act(ada.token, listening(t, noon))).toMatchObject({ ok: true });
    const going = await t.call("POST", "/v1/events/e_1/going", undefined, bob.token);
    expect(going.body.event).toMatchObject({ going: 1, youreGoing: true });
    expect((await t.call("GET", "/v1/events/e_1", undefined, cy.token)).body.event).toMatchObject({
      going: 1,
      youreGoing: false,
    });
    expect((await t.call("PUT", `/v1/residents/${cy.id}/block`, undefined, ada.token)).status).toBe(
      200,
    );
    expect((await t.call("POST", "/v1/events/e_1/going", undefined, cy.token)).status).toBe(404);
    expect(await t.act(cy.token, { type: "join_event", event: "e_1" })).toMatchObject({
      ok: false,
    });

    const checkin = (await t.call("GET", "/v1/checkin", undefined, bob.token)).body;
    expect(checkin.events.soon.map((e: Json) => e.id)).toEqual(["e_1"]);
    const line = checkin.todo.find((l: string) => l.startsWith("e_1 starts"));
    expect(line).toContain(t.iso(noon));
    expect(checkin.todo.join("\n")).not.toContain("Sunday records");
    // Once it's on, the check-in says how to get there.
    t.later(noon + MINUTE - t.now());
    const live = (await t.call("GET", "/v1/checkin", undefined, bob.token)).body;
    expect(live.events.live.map((e: Json) => e.id)).toEqual(["e_1"]);
    expect(live.todo.join("\n")).toContain('{"type": "join_event", "event": "e_1"}');
    expect(
      (await t.call("DELETE", "/v1/events/e_1/going", undefined, bob.token)).body.event,
    ).toMatchObject({ going: 0, youreGoing: false });
  });
});

describe("staff", () => {
  it("can call off a reported event, with the deposit back and the reports closed", async () => {
    const t = await start();
    const { ada, bob, cy } = await hosts(t);
    expect(await t.act(ada.token, listening(t, todayAt(t, 12), { px: 1, py: 1 }))).toMatchObject({
      ok: true,
    });
    const report = await t.call(
      "POST",
      "/v1/reports",
      { kind: "event", id: "e_1", reason: "spam" },
      bob.token,
    );
    expect(report.status).toBe(201);
    t.maintainers.add(cy.id);
    const queue = (await t.call("GET", "/v1/admin/reports", undefined, cy.token)).body.items;
    expect(queue).toMatchObject([{ kind: "event", id: "e_1", target: { exists: true } }]);
    const why = { reason: "Not an event, an ad." };
    expect((await t.call("POST", "/v1/admin/events/e_1/void", why, bob.token)).status).toBe(403);
    // The deposit is coins the world still holds: snapshots count it, and so does the treasury.
    expect(supplyHolds(t.service.state)).toBe(true);
    const treasury = (await t.call("GET", "/v1/town")).body.treasury;
    expect(treasury.held).toBe(10);
    const purse = async () => (await t.call("GET", "/v1/purse", undefined, ada.token)).body.purse;
    const before = (await purse()).balance;
    const done = await t.call("POST", "/v1/admin/events/e_1/void", why, cy.token);
    expect(done.body.event).toMatchObject({
      status: "cancelled",
      title: "Called off by a maintainer",
    });
    expect((await purse()).balance).toBe(before + 10);
    // A token maintainer is logged by their resident id, an Access sign-in by an opaque one.
    expect(t.service.state.events?.list[0]?.voidedBy).toBe(cy.id);
    expect((await t.call("GET", "/v1/admin/reports", undefined, cy.token)).body.items).toEqual([]);
  });
});

describe("who counts as a guest", () => {
  /** A world where Ada hosted e_1 on her plot, shared with Fay, and everyone listed attended. */
  function ended(): WorldState {
    const state = createWorld(CONFIG);
    const ok = (actor: string, command: Parameters<typeof apply>[1]["command"]) =>
      expect(apply(state, { actor, command }).ok).toBe(true);
    ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
    const homes = [
      ["ada", 0, 0],
      ["bob", 2, 0],
      ["cy", 0, 2],
      ["dee", 2, 2],
      ["eve", 1, 0],
      ["fay", 0, 1],
      ["gus", 2, 1],
      ["hal", 1, 2],
    ] as const;
    // Everyone has a plot and a hearth, so each one left out below is left out for one reason.
    for (const [id, px, py] of homes) {
      ok(id, { type: "join", name: id, kind: id === "bob" || id === "hal" ? "agent" : "human" });
      ok(id, { type: "settle", px, py });
      ok(id, { type: "build_starter_home" });
    }
    ok("ada", { type: "share_plot", with: "fay" });
    // Dee is linked to Ada and to Hal: Hal is in Ada's household too, like two AIs of one person.
    ok(TOWN_ACTOR, { type: "add_owner_pair", pair: ["ada", "dee"] });
    ok(TOWN_ACTOR, { type: "add_owner_pair", pair: ["dee", "hal"] });
    ok(TOWN_ACTOR, { type: "new_day", day: 20_003 });
    ok("ada", { type: "move", dir: "n" });
    ok("ada", {
      type: "schedule_event",
      kind: "show",
      title: "Puppets",
      px: 0,
      py: 0,
      startsAt: 20_003 * DAY_MS + 20 * HOUR,
      minutes: 60,
    });
    const e = state.events?.list[0];
    if (!e) throw new Error("no event");
    e.status = "ended";
    e.attended = ["bob", "cy", "dee", "eve", "fay", "gus", "hal"];
    return state;
  }

  it("leaves out new residents, the host's household, the plot's own, blocks, and a third host", () => {
    const state = ended();
    const e = state.events?.list[0];
    if (!e) throw new Error("no event");
    const guests = countGuests(state, e, {
      // Eve joined today; everyone else three days ago.
      ageDays: (id) => (id === "eve" ? 0 : 3),
      blockedEither: (a, b) => [a, b].includes("ada") && [a, b].includes("gus"),
      // Cy already counted for two other hosts today.
      hostsToday: (id) => new Set(id === "cy" ? ["r_x", "r_y"] : []),
    });
    expect(guests).toEqual([
      { id: "bob", kind: "agent", counted: true },
      { id: "cy", kind: "human", counted: false },
      { id: "dee", kind: "human", counted: false },
      { id: "eve", kind: "human", counted: false },
      { id: "fay", kind: "human", counted: false },
      { id: "gus", kind: "human", counted: false },
      { id: "hal", kind: "agent", counted: false },
    ]);
    // With room in Cy's day, Cy counts.
    const roomy = countGuests(state, e, {
      ageDays: () => 3,
      blockedEither: () => false,
      hostsToday: (id) => new Set(id === "cy" ? ["r_x"] : []),
    });
    expect(roomy.find((g) => g.id === "cy")?.counted).toBe(true);
    // Once Hal and Dee aren't linked, Hal is outside Ada's household and counts.
    const unlink = apply(state, {
      actor: TOWN_ACTOR,
      command: { type: "remove_owner_pair", pair: ["dee", "hal"] },
    });
    expect(unlink.ok).toBe(true);
    const apart = countGuests(state, e, {
      ageDays: () => 3,
      blockedEither: () => false,
      hostsToday: () => new Set(),
    });
    expect(apart.find((g) => g.id === "hal")?.counted).toBe(true);
  });
});
