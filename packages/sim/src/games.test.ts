import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { GAMES_CONFIG, GAMES_HASH, GAMES_LOG } from "./fixtures/games-log";
import {
  activeTable,
  GAMES,
  gameTableTiles,
  ladderRows,
  ratingOf,
  roundBoards,
  tableById,
} from "./games";
import { canonicalJson, hashWorld } from "./hash";
import { replay } from "./replay";
import {
  type Command,
  type GameKind,
  type GamePace,
  type ResidentKind,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
import { chebyshev, createWorld } from "./world";

// 3x3 plots of 8 tiles; the Commons is plot (1,1).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const DAY = 20_000;
const SALT = "0123456789abcdef0123456789abcdef";
/** Eight residents, one on each plot around the Commons. */
const RESIDENTS: [string, ResidentKind, number, number][] = [
  ["ada", "human", 0, 0],
  ["bob", "human", 1, 0],
  ["cy", "human", 2, 0],
  ["gus", "human", 0, 1],
  ["dee", "agent", 2, 1],
  ["eve", "agent", 0, 2],
  ["fay", "agent", 1, 2],
  ["hal", "agent", 2, 2],
];

/**
 * A world where eight residents have held their plots, with hearths, long enough to play rated.
 * Every rejection is checked to change nothing.
 */
function games() {
  const state = createWorld(CONFIG);
  let clock = 1_000;
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state), `${actor} ${JSON.stringify(command)}`).toBe(before);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const code = (actor: string, command: Command) => {
    const result = send(actor, command);
    return result.ok ? null : result.rejection.code;
  };
  const town = (command: Command) => ok(TOWN_ACTOR, command);
  town({ type: "new_day", day: DAY });
  for (const [name, kind, px, py] of RESIDENTS) {
    ok(name, { type: "join", name, kind });
    ok(name, { type: "settle", px, py });
    ok(name, { type: "build_starter_home" });
  }
  town({ type: "new_day", day: DAY + 3 });
  /** The server's clock, a second later each time it's read. */
  const tick = () => {
    clock += 1_000;
    return clock;
  };
  const opening = (game: GameKind = "hearth_race", pace: GamePace = "slow"): Command => ({
    type: "open_table",
    game,
    pace,
    salt: SALT,
    at: tick(),
  });
  /** Open a table and return its id. */
  const open = (actor: string, game: GameKind = "hearth_race", pace: GamePace = "slow") => {
    const opened = ok(actor, opening(game, pace)).find((e) => e.type === "table_opened");
    return opened?.type === "table_opened" ? opened.table : "";
  };
  const start = (actor: string, table: string) =>
    ok(actor, { type: "start_game", table, at: tick() });
  /** A table with these seats, started. The first one opens it. */
  const table = (game: GameKind, seats: string[], pace: GamePace = "slow") => {
    const id = open(seats[0] ?? "", game, pace);
    for (const s of seats.slice(1)) ok(s, { type: "sit", table: id, at: tick() });
    return { id, started: start(seats[0] ?? "", id) };
  };
  const round = (id: string) => tableById(state, id)?.round ?? 0;
  /** Each pick for the round being played (`null` decides nothing), then the close's events. */
  const play = (id: string, picks: Record<string, number | null>) => {
    const n = round(id);
    for (const [who, move] of Object.entries(picks)) {
      if (move !== null) ok(who, { type: "decide", table: id, round: n, move });
    }
    return town({ type: "close_round", table: id, round: n, at: tick() });
  };
  /** A two-seat race the first seat wins in four rounds of 3 against 2. */
  const race = (winner: string, loser: string, pace: GamePace = "slow") => {
    const { id, started } = table("hearth_race", [winner, loser], pace);
    let events: WorldEvent[] = [];
    for (let i = 0; i < 4; i++) events = play(id, { [winner]: 3, [loser]: 2 });
    return { id, started, events };
  };
  return { state, send, ok, code, town, opening, open, start, table, play, round, race };
}

const over = (events: WorldEvent[]) => events.find((e) => e.type === "game_over");
const rated = (events: WorldEvent[]) => {
  const e = events.find((x) => x.type === "game_started");
  return e?.type === "game_started" ? e.rated : undefined;
};

describe("the games fixture", () => {
  it("replays two whole games to the pinned hash", () => {
    const state = replay(GAMES_CONFIG, GAMES_LOG);
    expect(state.games?.finished.map((t) => [t.id, t.game, t.places])).toEqual([
      ["g_2", "hearth_race", { ada: 1, dee: 2, clem: 3 }],
      ["g_3", "lowest_lantern", { bob: 4, eve: 1, dee: 1, clem: 3 }],
    ]);
    expect(ladderRows(state, "people:slow")).toEqual([
      { resident: "ada", rating: 1016, games: 1 },
      { resident: "dee", rating: 984, games: 1 },
    ]);
    expect(ladderRows(state, "agents:live").map((r) => r.resident)).toEqual(["eve", "bob"]);
    expect(state.games?.tally).toEqual({ people: 1, agents: 0 });
    expect(hashWorld(state)).toBe(GAMES_HASH);
  });

  it("works each round's board out again from the choices, ending where the game ended", () => {
    const state = replay(GAMES_CONFIG, GAMES_LOG);
    for (const t of state.games?.finished ?? []) {
      const boards = roundBoards(t);
      expect(boards).toHaveLength(t.rounds.length);
      expect(boards.at(-1)).toEqual(t.board);
    }
    const race = tableById(state, "g_2");
    expect(race && roundBoards(race).slice(0, 3)).toEqual([
      { ada: 0, dee: 0, clem: 1 },
      { ada: 3, dee: 2, clem: 1 },
      { ada: 3, dee: 4, clem: 1 },
    ]);
  });
});

describe("opening a table", () => {
  it("takes the first free spot in the Commons and puts its opener beside it", () => {
    const w = games();
    const spots = gameTableTiles(CONFIG);
    expect(spots).toHaveLength(4);
    const events = w.ok("ada", w.opening());
    expect(events).toMatchObject([
      { type: "table_opened", table: "g_1", x: spots[0]?.x, y: spots[0]?.y, by: "ada" },
      { type: "seated", table: "g_1", resident: "ada", kind: "human" },
      { type: "moved", residentId: "ada" },
    ]);
    const ada = w.state.residents.ada;
    expect(ada && spots[0] && chebyshev(ada, spots[0])).toBe(1);
    expect(w.open("bob")).toBe("g_2");
    expect(activeTable(w.state, "g_2")?.place).toEqual(spots[1]);
    // A block on a spot keeps tables off it.
    const third = spots[2];
    if (third) w.state.blocks[`${third.x},${third.y}`] = "stone";
    expect(w.open("cy")).toBe("g_3");
    expect(activeTable(w.state, "g_3")?.place).toEqual(spots[3]);
    expect(w.code("gus", w.opening())).toBe("table_limit");
  });

  it("refuses what the server didn't stamp, a second waiting table, and a fourth seat", () => {
    const w = games();
    const opening = w.opening() as Extract<Command, { type: "open_table" }>;
    for (const wrong of [
      { game: "chess" },
      { pace: "fast" },
      { salt: "too short" },
      { salt: SALT.toUpperCase() },
      { at: -1 },
      { at: 1.5 },
    ]) {
      expect(w.code("ada", { ...opening, ...wrong } as Command)).toBe("invalid_game");
    }
    w.open("ada");
    expect(w.code("ada", w.opening())).toBe("table_limit");
    // Seats at three tables, one of them your own, are the most.
    w.open("bob");
    w.open("cy");
    w.ok("ada", { type: "sit", table: "g_2", at: 1 });
    w.ok("ada", { type: "sit", table: "g_3", at: 1 });
    w.open("gus");
    expect(w.code("ada", { type: "sit", table: "g_4", at: 1 })).toBe("table_limit");

    // Tables are opened from home; anyone may sit at one.
    w.ok("ivy", { type: "join", name: "Ivy", kind: "human" });
    expect(w.code("ivy", w.opening())).toBe("no_hearth");
    w.ok("ivy", { type: "sit", table: "g_1", at: 1 });

    const days = createWorld(CONFIG);
    apply(days, { actor: "ada", command: { type: "join", name: "Ada", kind: "human" } });
    expect(apply(days, { actor: "ada", command: opening })).toMatchObject({
      rejection: { code: "not_due" },
    });
  });
});

describe("seats", () => {
  it("are taken from anywhere and given up before the start, and a table nobody sits at closes", () => {
    const w = games();
    const id = w.open("ada");
    const events = w.ok("bob", { type: "sit", table: id, at: 1 });
    expect(events).toMatchObject([
      { type: "seated", table: id, resident: "bob", kind: "human" },
      { type: "moved", residentId: "bob" },
    ]);
    expect(w.code("bob", { type: "sit", table: id, at: 1 })).toBe("already_seated");
    expect(w.code("cy", { type: "stand", table: id })).toBe("not_seated");
    // The first seat passes on when its resident stands.
    w.ok("ada", { type: "stand", table: id });
    expect(w.code("bob", { type: "start_game", table: id, at: 5 })).toBe("not_enough_players");
    expect(w.ok("bob", { type: "stand", table: id })).toEqual([
      { type: "stood", table: id, resident: "bob" },
      { type: "table_closed", table: id },
    ]);
    expect(w.code("cy", { type: "sit", table: id, at: 1 })).toBe("unknown_table");
    expect(w.code("cy", { type: "sit", table: "g_9", at: 1 })).toBe("unknown_table");
  });

  it("fill up, and stay put once the game starts", () => {
    const w = games();
    const id = w.open("ada");
    for (const s of ["bob", "cy", "gus", "dee", "eve"]) w.ok(s, { type: "sit", table: id, at: 1 });
    expect(w.code("fay", { type: "sit", table: id, at: 1 })).toBe("table_full");
    w.start("ada", id);
    expect(w.code("fay", { type: "sit", table: id, at: 1 })).toBe("table_not_open");
    expect(w.code("bob", { type: "stand", table: id })).toBe("table_not_open");
  });

  it("start from the first seat, or anyone seated once the server says, with enough players, once", () => {
    const w = games();
    const id = w.open("ada", "lowest_lantern");
    w.ok("bob", { type: "sit", table: id, at: 1 });
    expect(w.code("bob", { type: "start_game", table: id, at: 5 })).toBe("not_your_table");
    expect(w.code("cy", { type: "start_game", table: id, at: 5 })).toBe("not_seated");
    expect(w.code("ada", { type: "start_game", table: id, at: 5 })).toBe("not_enough_players");
    w.ok("cy", { type: "sit", table: id, at: 1 });
    expect(w.code("ada", { type: "start_game", table: id, at: -5 })).toBe("invalid_game");
    const late = { type: "start_game", table: id, at: 5, free: "yes" } as unknown as Command;
    expect(w.code("bob", late)).toBe("invalid_game");
    // The server's `free` lets another seat start it, but never a townsfolk seat.
    w.town({ type: "set_townsfolk", ids: ["cy"] });
    expect(w.code("cy", { type: "start_game", table: id, at: 5, free: true })).toBe(
      "not_your_table",
    );
    w.ok("bob", { type: "start_game", table: id, at: 5, free: true });
    expect(w.code("ada", { type: "start_game", table: id, at: 5 })).toBe("table_not_open");
  });

  it("close once nobody but townsfolk is left, and never let townsfolk start", () => {
    const w = games();
    w.town({ type: "set_townsfolk", ids: ["cy", "gus"] });
    const id = w.open("ada", "lowest_lantern");
    for (const s of ["cy", "bob", "gus"]) w.ok(s, { type: "sit", table: id, at: 1 });
    // Ada stands: Bob is the first seat that isn't townsfolk, so he starts it now.
    w.ok("ada", { type: "stand", table: id });
    expect(w.code("cy", { type: "start_game", table: id, at: 5 })).toBe("not_your_table");
    expect(w.code("ada", w.opening())).toBeNull();
    expect(w.code("bob", w.opening())).toBe("table_limit");
    // Bob stands too, and a table only townsfolk sit at closes.
    expect(w.ok("bob", { type: "stand", table: id })).toEqual([
      { type: "stood", table: id, resident: "bob" },
      { type: "table_closed", table: id },
    ]);
    expect(activeTable(w.state, id)).toBeUndefined();
  });
});

describe("sealed rounds", () => {
  it("take one legal choice from each seat for the round being played", () => {
    const w = games();
    const id = w.open("ada");
    w.ok("bob", { type: "sit", table: id, at: 1 });
    const decide = (actor: string, round: number, move: number) =>
      w.code(actor, { type: "decide", table: id, round, move });
    expect(decide("ada", 1, 2)).toBe("wrong_round");
    w.start("ada", id);
    expect(decide("ada", 2, 2)).toBe("wrong_round");
    for (const move of [0, 4, 1.5]) expect(decide("ada", 1, move)).toBe("illegal_move");
    expect(decide("cy", 1, 2)).toBe("not_seated");
    expect(w.code("ada", { type: "decide", table: "g_9", round: 1, move: 2 })).toBe(
      "unknown_table",
    );
    const words = { type: "decide", table: id, round: 1, move: "2" } as unknown as Command;
    expect(w.code("bob", words)).toBe("illegal_move");
    expect(decide("ada", 1, 2)).toBeNull();
    expect(decide("ada", 1, 3)).toBe("already_decided");
    const lantern = w.table("lowest_lantern", ["cy", "gus", "dee"]).id;
    for (const move of [0, 11]) {
      expect(w.code("cy", { type: "decide", table: lantern, round: 1, move })).toBe("illegal_move");
    }
  });

  it("come out together when the round closes, with the default for a seat that didn't choose", () => {
    const w = games();
    const { id } = w.table("hearth_race", ["ada", "bob"]);
    expect(w.play(id, { ada: 2, bob: null })).toEqual([
      {
        type: "round_closed",
        table: id,
        round: 1,
        moves: { ada: 2, bob: null },
        board: { ada: 2, bob: 0 },
        away: [],
        next: { round: 2, at: expect.any(Number) },
      },
    ]);
    expect(activeTable(w.state, id)?.sealed).toEqual({});
  });

  it("count the same whatever order they came in", () => {
    const closes = (order: [string, number][]) => {
      const w = games();
      const { id } = w.table("lowest_lantern", ["ada", "bob", "cy"]);
      for (const [who, move] of order) w.ok(who, { type: "decide", table: id, round: 1, move });
      const hashBefore = hashWorld(w.state);
      const events = w.town({ type: "close_round", table: id, round: 1, at: 99 });
      return { hashBefore, events, hash: hashWorld(w.state) };
    };
    const first = closes([
      ["ada", 1],
      ["bob", 1],
      ["cy", 2],
    ]);
    const last = closes([
      ["cy", 2],
      ["bob", 1],
      ["ada", 1],
    ]);
    expect(last).toEqual(first);
  });

  it("hash with the table's secret after the choices, so the hash can't give one away", () => {
    // FNV-1a steps can be undone. With the secret before the choices, anyone could run the hash
    // back over the bytes they know and try each move against the hash after a decide.
    const w = games();
    const { id } = w.table("hearth_race", ["ada", "bob"]);
    w.ok("ada", { type: "decide", table: id, round: 1, move: 3 });
    const json = canonicalJson(activeTable(w.state, id));
    expect(json).toContain('"sealed":{"ada":3}');
    expect(json.indexOf(`"secret":"${SALT}"`)).toBeGreaterThan(json.indexOf('"sealed":'));
  });

  it("close only from the server, and only the round being played", () => {
    const w = games();
    const { id } = w.table("hearth_race", ["ada", "bob"]);
    const waiting = w.open("cy");
    expect(w.code("ada", { type: "close_round", table: id, round: 1, at: 9 })).toBe("server_only");
    expect(w.code("cy", { type: "close_table", table: waiting })).toBe("server_only");
    const town = (command: Command) => w.code(TOWN_ACTOR, command);
    expect(town({ type: "close_round", table: id, round: 2, at: 9 })).toBe("wrong_round");
    expect(town({ type: "close_round", table: waiting, round: 0, at: 9 })).toBe("wrong_round");
    expect(town({ type: "close_round", table: id, round: 1, at: -9 })).toBe("invalid_game");
    expect(town({ type: "close_table", table: id })).toBe("table_not_open");
    expect(town({ type: "close_table", table: waiting })).toBeNull();
    expect(town({ type: "close_table", table: waiting })).toBe("unknown_table");
  });
});

describe("Hearth race", () => {
  it("moves a pick nobody shares and blocks a pick two seats share", () => {
    const w = games();
    const { id } = w.table("hearth_race", ["ada", "bob", "cy"]);
    expect(w.play(id, { ada: 2, bob: 2, cy: 1 })).toMatchObject([
      { board: { ada: 0, bob: 0, cy: 1 } },
    ]);
    expect(w.play(id, { ada: 3, bob: 2, cy: 1 })).toMatchObject([
      { board: { ada: 3, bob: 2, cy: 2 } },
    ]);
  });

  it("goes to the first seat home, and to the higher pick when two get there together", () => {
    const w = games();
    const { id } = w.table("hearth_race", ["ada", "bob", "cy"]);
    for (let i = 0; i < 3; i++) w.play(id, { ada: 3, bob: 2, cy: 1 });
    w.play(id, { ada: 2, bob: 3, cy: 1 });
    // Ada at 11 and Bob at 9 both get home: Bob's 3 beats Ada's 1.
    for (const [who, move] of [
      ["ada", 1],
      ["bob", 3],
      ["cy", 2],
    ] as const) {
      w.ok(who, { type: "decide", table: id, round: 5, move });
    }
    const events = w.town({ type: "close_round", table: id, round: 5, at: 99_000 });
    expect(events[0]).toMatchObject({ board: { ada: 12, bob: 12, cy: 6 } });
    expect(events[0]).not.toHaveProperty("next");
    expect(over(events)).toMatchObject({ places: { bob: 1, ada: 2, cy: 3 }, salt: SALT });
    expect(activeTable(w.state, id)).toBeUndefined();
    expect(tableById(w.state, id)).toMatchObject({ status: "over", endedAt: 99_000 });
    expect(w.code("ada", { type: "decide", table: id, round: 6, move: 1 })).toBe("wrong_round");
    expect(w.code("ada", { type: "sit", table: id, at: 1 })).toBe("table_not_open");
  });

  it("ends after its last round with the furthest along first and equal places shared", () => {
    const w = games();
    const { id } = w.table("hearth_race", ["ada", "bob", "cy", "gus"]);
    w.play(id, { ada: 3, bob: 1, cy: 2, gus: 2 });
    let events: WorldEvent[] = [];
    for (let n = 2; n <= 30; n++) events = w.play(id, { ada: 1, bob: 1, cy: 1, gus: 1 });
    expect(events[0]).toMatchObject({ round: 30, board: { ada: 3, bob: 1, cy: 0, gus: 0 } });
    expect(over(events)).toMatchObject({ places: { ada: 1, bob: 2, cy: 3, gus: 3 } });
  });
});

describe("Lowest lantern", () => {
  it("scores the lowest pick nobody shares, and after five rounds the most points win", () => {
    const w = games();
    const { id } = w.table("lowest_lantern", ["ada", "bob", "cy"]);
    expect(w.play(id, { ada: 2, bob: 2, cy: 5 })).toMatchObject([
      { board: { ada: 0, bob: 0, cy: 1 } },
    ]);
    // Nobody picks alone: nobody scores.
    expect(w.play(id, { ada: 1, bob: 1, cy: null })).toMatchObject([
      { board: { ada: 0, bob: 0, cy: 1 } },
    ]);
    w.play(id, { ada: 1, bob: 3, cy: 2 });
    w.play(id, { ada: 4, bob: 1, cy: 4 });
    const events = w.play(id, { ada: 7, bob: 9, cy: 8 });
    expect(events[0]).toMatchObject({ round: 5, board: { ada: 2, bob: 1, cy: 1 } });
    expect(over(events)).toMatchObject({ places: { ada: 1, bob: 2, cy: 2 } });
  });
});

describe("away seats", () => {
  it("play the default after two missed rounds until they decide again, and a table all away ends", () => {
    const w = games();
    const { id } = w.table("hearth_race", ["ada", "bob"]);
    expect(w.play(id, { ada: 3, bob: null })).toMatchObject([{ away: [] }]);
    expect(w.play(id, { ada: 1, bob: null })).toMatchObject([{ away: ["bob"] }]);
    expect(w.play(id, { ada: null, bob: 2 })).toMatchObject([{ away: [] }]);
    w.play(id, { ada: null, bob: null });
    const events = w.play(id, { ada: null, bob: null });
    expect(events[0]).toMatchObject({ away: ["ada", "bob"], board: { ada: 4, bob: 2 } });
    expect(over(events)).toMatchObject({ places: { ada: 1, bob: 2 } });
  });
});

describe("ratings", () => {
  it("move a win between equals by 16 on the ladder of the seats' kind and pace", () => {
    const w = games();
    const { started, events } = w.race("ada", "bob");
    expect(rated(started)).toEqual(["ada", "bob"]);
    expect(over(events)).toMatchObject({
      ratings: [
        { resident: "ada", ladder: "people:slow", rating: 1016, change: 16 },
        { resident: "bob", ladder: "people:slow", rating: 984, change: -16 },
      ],
    });
    w.race("dee", "eve", "live");
    expect(ladderRows(w.state, "agents:live")).toEqual([
      { resident: "dee", rating: 1016, games: 1 },
      { resident: "eve", rating: 984, games: 1 },
    ]);
    expect(ratingOf(w.state, "people:live", "ada")).toBe(GAMES.ratingStart);
    expect(w.state.games?.tally).toBeUndefined();
  });

  it("weigh a result by what the ratings expected", () => {
    const w = games();
    w.race("ada", "bob");
    // Rated 32 apart, the favorite gains less for winning again.
    w.race("ada", "bob");
    expect(ratingOf(w.state, "people:slow", "ada")).toBe(1031);
    expect(ratingOf(w.state, "people:slow", "bob")).toBe(969);
    // And loses more to the underdog.
    w.race("bob", "ada");
    expect(ratingOf(w.state, "people:slow", "ada")).toBe(1012);
    expect(ratingOf(w.state, "people:slow", "bob")).toBe(988);
  });

  it("count each pair at a bigger table, with shared places as halves", () => {
    const w = games();
    const { id } = w.table("lowest_lantern", ["ada", "bob", "cy"]);
    w.play(id, { ada: 1, bob: 2, cy: 2 });
    w.play(id, { ada: 2, bob: 1, cy: 2 });
    w.play(id, { ada: 1, bob: 2, cy: 2 });
    w.play(id, { ada: 2, bob: 1, cy: 2 });
    const events = w.play(id, { ada: 2, bob: 2, cy: 1 });
    expect(over(events)).toMatchObject({
      places: { ada: 1, bob: 1, cy: 3 },
      ratings: [
        { resident: "ada", change: 8 },
        { resident: "bob", change: 8 },
        { resident: "cy", change: -16 },
      ],
    });
  });

  it("keep people and agents off each other's ladders, and count them in the tally", () => {
    const w = games();
    const { started, events } = w.race("dee", "ada");
    expect(rated(started)).toEqual(["dee", "ada"]);
    expect(over(events)).toMatchObject({ ratings: [], tally: { people: 0, agents: 1 } });
    w.race("bob", "eve");
    expect(w.state.games?.tally).toEqual({ people: 1, agents: 1 });
    expect(w.state.games?.ratings).toBeUndefined();
  });

  it("leave out households, residents who couldn't vote, and townsfolk", () => {
    const w = games();
    // Ada shares her plot with Bob, so both play the whole table unrated.
    w.ok("ada", { type: "share_plot", with: "bob" });
    expect(rated(w.table("hearth_race", ["ada", "bob", "cy"]).started)).toEqual([]);
    // Two AIs of one person.
    w.town({
      type: "set_owner_pairs",
      pairs: [
        ["dee", "gus"],
        ["eve", "gus"],
      ],
    });
    expect(rated(w.table("hearth_race", ["dee", "eve", "fay", "hal"]).started)).toEqual([
      "fay",
      "hal",
    ]);
    // No plot of her own yet, and townsfolk.
    const w2 = games();
    w2.ok("ivy", { type: "join", name: "Ivy", kind: "human" });
    w2.town({ type: "set_townsfolk", ids: ["cy"] });
    expect(rated(w2.table("lowest_lantern", ["ada", "ivy", "bob", "cy"]).started)).toEqual([
      "ada",
      "bob",
    ]);
  });

  it(`stop counting a pair after ${GAMES.pairPerDay} games a day and a resident after ${GAMES.ratedPerDay}, until the next day`, () => {
    const w = games();
    for (let i = 0; i < GAMES.pairPerDay; i++) {
      expect(rated(w.race("ada", "bob").started)).toEqual(["ada", "bob"]);
    }
    expect(rated(w.race("ada", "bob").started)).toEqual([]);
    const others = ["cy", "gus", "dee", "eve", "fay", "hal"];
    for (let i = GAMES.pairPerDay; i < GAMES.ratedPerDay; i++) {
      expect(rated(w.race("ada", others[i % others.length] ?? "").started)).toContain("ada");
    }
    // Ada has had her 20; Dee and Bob haven't, and play each other rated at the same table.
    expect(rated(w.table("hearth_race", ["ada", "dee", "bob"]).started)).toEqual(["dee", "bob"]);
    w.town({ type: "new_day", day: DAY + 4 });
    expect(rated(w.race("ada", "bob").started)).toEqual(["ada", "bob"]);
  });

  it(`stop counting a pair after ${GAMES.pairPerWeek} games in a UTC week, until the next Monday`, () => {
    const w = games();
    // The world's day is a Monday.
    const monday = DAY + 3;
    let day = monday;
    for (let n = 0; n < GAMES.pairPerWeek; n++) {
      if (n > 0 && n % GAMES.pairPerDay === 0) {
        day += 1;
        w.town({ type: "new_day", day });
      }
      expect(rated(w.race("ada", "bob").started)).toEqual(["ada", "bob"]);
    }
    // A new day in the same week: the day's cap has room, the week's doesn't.
    day += 1;
    w.town({ type: "new_day", day });
    expect(rated(w.race("ada", "bob").started)).toEqual([]);
    expect(rated(w.race("ada", "cy").started)).toEqual(["ada", "cy"]);
    w.town({ type: "new_day", day: monday + 7 });
    expect(rated(w.race("ada", "bob").started)).toEqual(["ada", "bob"]);
  });
});
