import { GAME_TIMES, type ServerMessage, type WorldEvent } from "@terrakin/protocol";
import {
  fnv1a,
  residentById,
  SALT_PATTERN,
  type WorldConfig,
  type WorldState,
} from "@terrakin/sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { gameRatings, ladderView } from "./games";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, WorldService } from "./world-service";

/**
 * Party games (RFC 0011) over HTTP: the server stamps tables with its own salt and clock, closes
 * each round as soon as it's settled or when its window ends, seats townsfolk at a slow table that
 * needs them, keeps every choice sealed from every read until its round closes, and tells a
 * check-in whose move it is.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const START = Date.UTC(2026, 9, 5, 9);

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  vi.restoreAllMocks();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start() {
  let now = START;
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    presence: true,
  });
  const sql = nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => residentById(service.state, id),
    now: () => now,
  });
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    now: () => now,
  });
  cleanups.push(() => sql.close());
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  const get = async (path: string, token?: string) =>
    (await call("GET", path, undefined, token)).body;
  const join = (name: string, kind: "human" | "agent" = "human") => {
    const made = service.createSession({ name, kind });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  };
  /** A resident with a plot and a home, who can play rated once the plot is 3 days old. */
  const settler = async (
    name: string,
    px: number,
    py: number,
    kind: "human" | "agent" = "human",
  ) => {
    const r = join(name, kind);
    await act(r.token, { type: "settle", px, py });
    await act(r.token, { type: "build_starter_home" });
    return r;
  };
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WorldEvent[];
  };
  /** Move the server's clock on and let it catch up, as a request or its sweep would. */
  const later = (ms: number) => {
    now += ms;
    service.tick();
  };
  const table = async (id: string, token?: string) => (await get(`/v1/games/${id}`, token)).table;
  const decide = (token: string, round: number, move: number, id = "g_1") =>
    act(token, { type: "decide", table: id, round, move });
  return { call, act, get, join, settler, listen, later, table, decide, service, now: () => now };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("a table", () => {
  it("plays from open to over, each round closing as soon as every seat has decided", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const cy = t.join("Cy");
    t.later(3 * DAY_MS);
    // The server draws the salt and stamps the time; a salt or time in the body counts for nothing.
    const zeros = "0".repeat(32);
    const opened = await t.act(ada.token, {
      type: "open_table",
      game: "hearth_race",
      pace: "slow",
      salt: zeros,
      at: 1,
    });
    expect(opened).toMatchObject({
      ok: true,
      events: [{ type: "table_opened", table: "g_1", at: t.now() }, { type: "seated" }, {}],
    });
    const salt = t.service.state.games?.tables.g_1?.secret;
    expect(salt).toMatch(SALT_PATTERN);
    expect(salt).not.toBe(zeros);
    // Nobody sits across a block.
    await t.call("PUT", `/v1/residents/${ada.id}/block`, undefined, cy.token);
    expect(await t.act(cy.token, { type: "sit", table: "g_1" })).toMatchObject({
      error: { code: "forbidden" },
    });
    await t.act(bob.token, { type: "sit", table: "g_1" });
    expect(await t.act(ada.token, { type: "start_game", table: "g_1" })).toMatchObject({
      ok: true,
      events: [{ type: "game_started", rated: [ada.id, bob.id], at: t.now() }],
    });
    expect(await t.table("g_1", ada.token)).toMatchObject({
      status: "playing",
      round: 1,
      closesAt: iso(t.now() + GAME_TIMES.roundSeconds.slow * 1000),
      you: { seated: true, moves: ["decide"], legal: [1, 2, 3], sealed: null },
    });

    await t.decide(ada.token, 1, 3);
    expect((await t.table("g_1", ada.token)).you.sealed).toBe(3);
    expect(await t.table("g_1", bob.token)).toMatchObject({
      round: 1,
      seats: [{ decided: true }, { decided: false }],
      you: { sealed: null, moves: ["decide"] },
    });
    // Bob's choice settles the round, and it closes at once, hours before its window ends.
    await t.decide(bob.token, 1, 2);
    expect(await t.table("g_1")).toMatchObject({
      round: 2,
      last: { round: 1, moves: { [ada.id]: 3, [bob.id]: 2 }, gained: { [ada.id]: 3, [bob.id]: 2 } },
      seats: [{ score: 3 }, { score: 2 }],
      you: null,
    });
    for (let round = 2; round <= 4; round++) {
      await t.decide(ada.token, round, 3);
      await t.decide(bob.token, round, 2);
    }

    const over = await t.table("g_1", bob.token);
    expect(over).toMatchObject({
      status: "over",
      closesAt: null,
      salt,
      seats: [
        { place: 1, rating: { ladder: "people:slow", rating: 1016, change: 16 } },
        { place: 2, rating: { ladder: "people:slow", rating: 984, change: -16 } },
      ],
      you: { moves: [], legal: [] },
    });
    expect(over.history).toHaveLength(4);
    expect(await t.get("/v1/games")).toMatchObject({
      open: [],
      playing: [],
      finished: [{ id: "g_1", status: "over" }],
    });
    expect(await t.get("/v1/games/ladders?ladder=people:slow", bob.token)).toMatchObject({
      ladder: "people:slow",
      rows: [
        { resident: { id: ada.id }, rating: 1016, games: 1, rank: 1 },
        { resident: { id: bob.id }, rating: 984, games: 1, rank: 2 },
      ],
      you: { rating: 984, games: 1, rank: 2 },
    });
    expect((await t.get(`/v1/residents/${ada.id}`)).resident.games).toEqual([
      { ladder: "people:slow", rating: 1016, games: 1, rank: 1 },
    ]);
    expect((await t.call("GET", "/v1/games/g_9")).status).toBe(404);
  });

  it("says whose rating a game can move, and whose finish counts only for people against AIs", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const dot = await t.settler("Dot", 2, 0, "agent");
    const eli = await t.settler("Eli", 0, 2, "agent");
    t.later(3 * DAY_MS);
    await t.act(ada.token, { type: "open_table", game: "hearth_race", pace: "slow" });
    await t.act(dot.token, { type: "sit", table: "g_1" });
    await t.act(eli.token, { type: "sit", table: "g_1" });
    expect((await t.table("g_1")).seats.map((s: Json) => [s.rated, s.tally])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    await t.act(ada.token, { type: "start_game", table: "g_1" });
    // Ada is the only person, so no rating of hers can move; her finish against each agent counts.
    expect((await t.table("g_1")).seats.map((s: Json) => [s.kind, s.rated, s.tally])).toEqual([
      ["human", false, true],
      ["agent", true, true],
      ["agent", true, true],
    ]);
  });

  it("lets anyone seated start once the first seat has let the start grace pass", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = t.join("Bob");
    await t.act(ada.token, { type: "open_table", game: "hearth_race", pace: "live" });
    await t.act(bob.token, { type: "sit", table: "g_1" });
    const grace = GAME_TIMES.startGraceMinutes.live * 60_000;
    t.later(grace - 1_000);
    expect(await t.act(bob.token, { type: "start_game", table: "g_1" })).toMatchObject({
      error: { code: "not_your_table" },
    });
    // Standing up and sitting down again starts the wait over.
    await t.act(bob.token, { type: "stand", table: "g_1" });
    await t.act(bob.token, { type: "sit", table: "g_1" });
    t.later(grace - 1_000);
    expect((await t.table("g_1", bob.token)).you.moves).not.toContain("start_game");
    expect((await t.get("/v1/checkin", bob.token)).games.canStart).toEqual([]);
    t.later(1_000);
    expect((await t.table("g_1", bob.token)).you.moves).toContain("start_game");
    expect((await t.get("/v1/checkin", bob.token)).games.canStart).toEqual(["g_1"]);
    expect(await t.act(bob.token, { type: "start_game", table: "g_1" })).toMatchObject({
      ok: true,
      events: [{ type: "game_started", table: "g_1" }],
    });
  });

  it("closes a round when its window ends, playing the default for a seat that didn't decide, and lets an away seat back", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = t.join("Bob", "agent");
    await t.act(ada.token, { type: "open_table", game: "hearth_race", pace: "live" });
    await t.act(bob.token, { type: "sit", table: "g_1" });
    await t.act(ada.token, { type: "start_game", table: "g_1" });
    const window = GAME_TIMES.roundSeconds.live * 1000;
    await t.decide(ada.token, 1, 3);
    t.later(window - 1_000);
    expect((await t.table("g_1")).round).toBe(1);
    t.later(1_000);
    expect(await t.table("g_1")).toMatchObject({
      round: 2,
      last: { moves: { [ada.id]: 3, [bob.id]: null } },
      seats: [{ away: false }, { away: false }],
    });
    // A second miss in a row, and Bob is away: a round waits for him only a moment once Ada has
    // chosen, however fast she is.
    await t.decide(ada.token, 2, 3);
    t.later(window);
    expect((await t.table("g_1")).seats[1]).toMatchObject({ away: true });
    const wait = GAME_TIMES.awayWaitSeconds.live * 1000;
    await t.decide(ada.token, 3, 1);
    expect((await t.table("g_1")).round).toBe(3);
    t.later(wait);
    expect(await t.table("g_1")).toMatchObject({
      round: 4,
      last: { moves: { [ada.id]: 1, [bob.id]: null } },
    });
    // Choosing within the wait brings him back.
    await t.decide(ada.token, 4, 1);
    t.later(wait - 1_000);
    expect(await t.decide(bob.token, 4, 2)).toMatchObject({ ok: true });
    expect(await t.table("g_1")).toMatchObject({
      round: 5,
      last: { moves: { [ada.id]: 1, [bob.id]: 2 } },
      seats: [{ away: false }, { away: false }],
    });
  });
});

describe("ladders", () => {
  it("rank each resident 1 plus how many are rated higher, so equal ratings share a place", () => {
    const people = {
      ada: { rating: 1016, games: 2 },
      bob: { rating: 1016, games: 1 },
      cy: { rating: 984, games: 1 },
      dee: { rating: 1040, games: 3 },
    };
    const state = { games: { ratings: { "people:slow": people } } } as unknown as WorldState;
    const view = ladderView(state, "people:slow", "cy", () => undefined);
    expect(view.rows.map((r) => [r.resident.id, r.rank])).toEqual([
      ["dee", 1],
      ["bob", 2],
      ["ada", 2],
      ["cy", 4],
    ]);
    expect(view.you).toEqual({ rating: 984, games: 1, rank: 4 });
    expect(gameRatings(state, "ada")).toEqual([
      { ladder: "people:slow", rating: 1016, games: 2, rank: 2 },
    ]);
  });
});

describe("townsfolk", () => {
  it("fill a slow table short of players after an hour, unrated, by a rule anyone can check", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const folk = ["Clem", "Juniper", "Sage"].map((name) => t.join(name));
    t.service.syncTownsfolk(new Set(folk.map((f) => f.id)));
    await t.act(ada.token, { type: "open_table", game: "lowest_lantern", pace: "slow" });
    const hour = GAME_TIMES.townsfolkAfterMinutes * 60_000;
    t.later(hour - 60_000);
    expect((await t.table("g_1")).seats).toHaveLength(1);
    t.later(60_000);
    // Two, the seats Lowest lantern still needs to start, and no more.
    const seated = (await t.table("g_1")).seats.map((s: Json) => s.resident.id);
    expect(seated).toHaveLength(3);
    expect(seated[0]).toBe(ada.id);
    const helpers = seated.slice(1) as string[];
    for (const id of helpers) expect(folk.map((f) => f.id)).toContain(id);

    // They choose as soon as a round opens, so Ada's choice closes it.
    await t.act(ada.token, { type: "start_game", table: "g_1" });
    expect((await t.table("g_1")).seats.map((s: Json) => [s.decided, s.rated])).toEqual([
      [false, false],
      [true, false],
      [true, false],
    ]);
    for (let round = 1; round <= 5; round++) await t.decide(ada.token, round, 7);
    const over = await t.table("g_1");
    expect(over.status).toBe("over");
    // Each townsfolk pick is one of the three lowest moves, from the salt, the round, and the seat.
    for (const r of over.history as Json[]) {
      for (const id of helpers) {
        const pick = (Number.parseInt(fnv1a(`${over.salt}:${r.round}:${id}`), 16) % 3) + 1;
        expect(r.moves[id], `round ${r.round}`).toBe(pick);
      }
    }
  });

  it("leave with the last player, so they never hold a table's spot on their own", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const folk = ["Clem", "Juniper"].map((name) => t.join(name).id);
    t.service.syncTownsfolk(new Set(folk));
    const hour = GAME_TIMES.townsfolkAfterMinutes * 60_000;
    await t.act(ada.token, { type: "open_table", game: "lowest_lantern", pace: "slow" });
    t.later(hour);
    expect((await t.table("g_1")).seats).toHaveLength(3);
    expect(await t.act(ada.token, { type: "stand", table: "g_1" })).toMatchObject({
      ok: true,
      events: [{ type: "stood" }, { type: "table_closed", table: "g_1" }],
    });
    // Someone made townsfolk while seated leaves only townsfolk too, and the server closes it.
    await t.act(ada.token, { type: "open_table", game: "lowest_lantern", pace: "slow" });
    t.later(hour);
    expect((await t.table("g_2")).seats).toHaveLength(3);
    t.service.syncTownsfolk(new Set([...folk, ada.id]));
    t.later(1_000);
    expect((await t.call("GET", "/v1/games/g_2")).status).toBe(404);
  });

  it("never sit at a live table, which closes if nobody starts it", async () => {
    const t = await start();
    const bob = await t.settler("Bob", 0, 0);
    const clem = t.join("Clem");
    t.service.syncTownsfolk(new Set([clem.id]));
    await t.act(bob.token, { type: "open_table", game: "hearth_race", pace: "live" });
    t.later(GAME_TIMES.waitMinutes.live * 60_000 - 60_000);
    expect((await t.table("g_1")).seats).toHaveLength(1);
    t.later(60_000);
    expect((await t.call("GET", "/v1/games/g_1")).status).toBe(404);
  });
});

/**
 * Make `crypto.getRandomValues` count up from zero, so two servers built the same way get the same
 * resident ids, tokens, and salts.
 */
function sameRandomness() {
  let n = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) array[i] = (n++ * 151 + 7) & 0xff;
    return array;
  }) as typeof crypto.getRandomValues);
}

describe("a sealed choice", () => {
  /** A world where Ada has chosen `move` in round 1, with everything Bob and a visitor can read. */
  async function world(move: number) {
    vi.restoreAllMocks();
    sameRandomness();
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    t.later(3 * DAY_MS);
    const heard = t.listen(bob.id);
    const answers = [
      await t.act(ada.token, { type: "open_table", game: "hearth_race", pace: "slow" }),
      await t.act(bob.token, { type: "sit", table: "g_1" }),
      await t.act(ada.token, { type: "start_game", table: "g_1" }),
      await t.decide(ada.token, 1, move),
    ];
    const reads = {
      games: await t.get("/v1/games", bob.token),
      gamesVisitor: await t.get("/v1/games"),
      table: await t.get("/v1/games/g_1", bob.token),
      tableVisitor: await t.get("/v1/games/g_1"),
      ladder: await t.get("/v1/games/ladders?ladder=people:slow", bob.token),
      world: await t.get("/v1/world"),
      health: await t.get("/v1/health"),
      checkin: await t.get("/v1/checkin", bob.token),
      profile: await t.get(`/v1/residents/${ada.id}`, bob.token),
      socket: heard(),
    };
    return { t, ada, bob, answers, reads };
  }

  /**
   * Everything but the world's hash, which takes in the whole world, salt and all, and the links to
   * share, which name each test server's own port.
   */
  const unhashed = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (key, v) => (key === "hash" || key === "links" ? undefined : v)),
    );

  it("reaches nobody else through any read until its round closes", async () => {
    const one = await world(1);
    const three = await world(3);
    expect(three.ada.id).toBe(one.ada.id);
    // Each world holds Ada's choice...
    expect(three.reads.health.hash).not.toBe(one.reads.health.hash);
    // ...and nothing Bob or a visitor can read, or hear on the socket, says which.
    expect(unhashed(three.reads)).toEqual(unhashed(one.reads));
    expect(one.reads.socket).toContainEqual({
      type: "decided",
      table: "g_1",
      round: 1,
      resident: one.ada.id,
    });
    // Nor does anything anyone was sent carry the salt that keeps the hash from giving it away.
    const salt = one.t.service.state.games?.tables.g_1?.secret ?? "";
    expect(salt).toMatch(SALT_PATTERN);
    expect(JSON.stringify([one.reads, one.answers])).not.toContain(salt);

    // Once the round closes, the same read tells the worlds apart.
    for (const w of [one, three]) await w.t.decide(w.bob.token, 1, 2);
    expect((await one.t.table("g_1", one.bob.token)).last.moves[one.ada.id]).toBe(1);
    expect((await three.t.table("g_1", three.bob.token)).last.moves[three.ada.id]).toBe(3);
  });
});

describe("the check-in", () => {
  it("says whose move it is and how long is left, which table can start, and how a game ended", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = t.join("Bob", "agent");
    expect((await t.get("/v1/checkin", ada.token)).games).toBeUndefined();
    await t.act(ada.token, { type: "open_table", game: "hearth_race", pace: "slow" });
    await t.act(bob.token, { type: "sit", table: "g_1" });
    const ready = await t.get("/v1/checkin", ada.token);
    expect(ready.games).toEqual({ yourMove: [], canStart: ["g_1"], ended: [] });
    expect(ready.todo).toContain(
      'Table g_1 has enough players, and you can start it: {"type": "start_game", "table": "g_1"}, or wait for more.',
    );

    await t.act(ada.token, { type: "start_game", table: "g_1" });
    const first = await t.get("/v1/checkin", bob.token);
    expect(first.games.yourMove).toEqual([
      {
        table: "g_1",
        game: "hearth_race",
        pace: "slow",
        round: 1,
        closesAt: iso(t.now() + GAME_TIMES.roundSeconds.slow * 1000),
        links: { page: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/games\/g_1$/) },
      },
    ]);
    expect(first.todo).toContainEqual(
      expect.stringContaining("Your move at table g_1 (Hearth race, round 1), about 4 hours left."),
    );
    // A new round is news even to an assistant that says it saw the last check-in.
    await t.decide(ada.token, 1, 3);
    await t.decide(bob.token, 1, 2);
    const next = await t.get(`/v1/checkin?seen=${first.digest}`, bob.token);
    expect(next.unchanged).toBeUndefined();
    expect(next.games.yourMove).toMatchObject([{ table: "g_1", round: 2 }]);

    for (let round = 2; round <= 4; round++) {
      await t.decide(ada.token, round, 3);
      await t.decide(bob.token, round, 2);
    }
    const ended = await t.get("/v1/checkin", ada.token);
    expect(ended.games).toEqual({
      yourMove: [],
      canStart: [],
      ended: [
        {
          table: "g_1",
          game: "hearth_race",
          place: 1,
          seats: 2,
          links: { page: expect.stringMatching(/\/games\/g_1$/) },
        },
      ],
    });
    expect(ended.todo).toContain(
      "Game g_1 (Hearth race) ended: you came 1st of 2. Tell your owner how it went.",
    );
    // It's news once: a check-in after the one that said so leaves it out.
    const end = t.now();
    t.later(60_000);
    const after = await t.get(`/v1/checkin?since=${iso(end + 1_000)}`, ada.token);
    expect(after.games?.ended ?? []).toEqual([]);
    expect(after.todo).not.toContainEqual(expect.stringContaining("Game g_1"));
    expect((await t.get(`/v1/checkin?since=${iso(end)}`, ada.token)).games.ended).toHaveLength(1);
  });
});
