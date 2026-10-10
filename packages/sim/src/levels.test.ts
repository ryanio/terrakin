import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import type { Crop } from "./catalog";
import { LEVELS_CONFIG, LEVELS_HASH, LEVELS_LOG } from "./fixtures/levels-log";
import { MERGE_CONFIG, MERGE_LOG } from "./fixtures/merge-log";
import { REPEAT_JOINS_CONFIG, REPEAT_JOINS_LOG } from "./fixtures/repeat-joins-log";
import { pickupLeft, RECIPE_PAGE } from "./gather";
import { canonicalJson, hashWorld } from "./hash";
import { isFindKind } from "./items";
import {
  EARNED_WEAR_SKILL,
  firstSkill,
  firstsOf,
  levelOf,
  levelsOf,
  PROGRESS,
  pointsFor,
  pointsOf,
  TITLE_INFO,
  titleOf,
  UNLOCKS,
} from "./levels";
import { EARNED_WEAR, EARNED_WEAR_INFO, WEAR_ITEMS } from "./looks";
import { replay } from "./replay";
import { dayOfDate, weekStart } from "./season";
import { expectSupplyHolds, fund, stock } from "./test-support";
import {
  type Command,
  type FirstsCredit,
  SKILLS,
  type Skill,
  TITLES,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. The Commons is plot (1, 1). Settling lands on the plot's center, where
// the starter home puts its hearth: (3, 3) on plot (0, 0), inside a hut from (1, 1) to (5, 5).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const PLOTS: Record<string, readonly [number, number]> = {
  ada: [0, 0],
  bob: [2, 0],
  cy: [0, 2],
  dee: [2, 2],
  eve: [1, 0],
};
/** October 4, 2024, a Friday in autumn. */
const DAY = 20_000;
/** The Monday after, when levels open here and everyone settled on `DAY` may vote. */
const OPEN = DAY + 3;
const SALT = "0123456789abcdef0123456789abcdef";
/** `state.progress` in a world that opened levels on `OPEN` and where nobody has earned since. */
const NOTHING_YET = { opened: OPEN, points: {}, firsts: {} };

/**
 * A world where every input checks the supply identity afterwards (points are not coins), and
 * every rejection checks that nothing changed at all.
 */
function world() {
  const state = createWorld(CONFIG);
  let today = DAY;
  let clock = 1_000;
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state), `${actor} ${JSON.stringify(command)}`).toBe(before);
    expectSupplyHolds(state);
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
  const settle = (name: string) => {
    const [px, py] = PLOTS[name] ?? [0, 0];
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py });
    ok(name, { type: "build_starter_home" });
  };
  /** Move the world to `day`, or on by one. */
  const toDay = (day = today + 1) => {
    today = day;
    return town({ type: "new_day", day });
  };
  /** The server's clock for game inputs, a second later each time it's read. */
  const tick = () => {
    clock += 1_000;
    return clock;
  };
  /** Put a resident on a tile, as a walk there would. */
  const standAt = (id: string, x: number, y: number) => {
    const r = state.residents[id];
    if (!r) throw new Error(`${id} isn't here`);
    r.x = x;
    r.y = y;
  };
  const points = (id: string) => pointsOf(state, id);
  return { state, send, ok, code, town, settle, toDay, tick, standAt, points, day: () => today };
}
type World = ReturnType<typeof world>;

/**
 * Coins, items, the shop, bounties, finds, and recipes open, with Ada (who knows every recipe) and
 * Bob, Cy, and Dee (who came after recipes opened) settled long enough to vote, on `OPEN`. Levels
 * open last, with `firsts` as the one-time credit, unless `open` is false.
 */
function levels({ firsts = [] as FirstsCredit[], open = true } = {}): World {
  const w = world();
  w.town({ type: "new_day", day: DAY });
  w.town({ type: "open_economy" });
  w.town({ type: "open_items" });
  w.town({ type: "open_shop" });
  w.town({ type: "open_bounties" });
  w.town({ type: "open_finds" });
  w.settle("ada");
  w.town({ type: "open_recipes" });
  for (const name of ["bob", "cy", "dee"]) w.settle(name);
  w.toDay(OPEN);
  if (open) w.town({ type: "open_levels", firsts });
  return w;
}

/** The private `progress` events in an input's events. */
const progress = (events: WorldEvent[]) => events.filter((e) => e.type === "progress");
const reached = (events: WorldEvent[]) => events.filter((e) => e.type === "level_reached");

/**
 * `n` planters along the north and south edges of a resident's plot, each planted with `crop`,
 * all within reach of their hearth. Returns the tiles.
 */
function plant(w: World, who: string, crop: Crop, n = 1, from = 0) {
  const [px, py] = PLOTS[who] ?? [0, 0];
  stock(w.state, who, { [`${crop}_seed`]: n });
  const tiles: { x: number; y: number }[] = [];
  for (let i = from; i < from + n; i++) {
    const tile = { x: px * 8 + (i % 7), y: py * 8 + (i < 7 ? 0 : 6) };
    w.ok(who, { type: "place", ...tile, block: "planter" });
    w.ok(who, { type: "plant", ...tile, seed: crop });
    tiles.push(tile);
  }
  return tiles;
}

/** A workbench and a kitchen inside a resident's hut, beside their hearth. */
function stations(w: World, who: string) {
  const [px, py] = PLOTS[who] ?? [0, 0];
  const bench = { x: px * 8 + 4, y: py * 8 + 3 };
  const kitchen = { x: px * 8 + 4, y: py * 8 + 2 };
  w.ok(who, { type: "place", ...bench, block: "workbench" });
  w.ok(who, { type: "place", ...kitchen, block: "kitchen" });
  return { bench, kitchen };
}

/** A tile where something `wanted` lies today, looking a day further on until one does. */
function lying(w: World, wanted: (kind: string) => boolean) {
  for (let tries = 0; tries < 400; tries++) {
    for (let y = 0; y < CONFIG.height; y++) {
      for (let x = 0; x < CONFIG.width; x++) {
        const kind = pickupLeft(w.state, x, y);
        if (kind && wanted(kind)) return { x, y, kind };
      }
    }
    w.toDay();
  }
  throw new Error("nothing like that lay anywhere for 400 days");
}

/** A tile within reach of two finds of the same kind today, looking days on until there is one. */
function twoOfAKind(w: World) {
  for (let tries = 0; tries < 400; tries++) {
    for (let y = 0; y < CONFIG.height; y++) {
      for (let x = 0; x < CONFIG.width; x++) {
        const kinds: string[] = [];
        for (let dy = -CONFIG.reach; dy <= CONFIG.reach; dy++) {
          for (let dx = -CONFIG.reach; dx <= CONFIG.reach; dx++) {
            if (x + dx < 0 || y + dy < 0 || x + dx >= CONFIG.width || y + dy >= CONFIG.height) {
              continue;
            }
            const kind = pickupLeft(w.state, x + dx, y + dy);
            if (isFindKind(kind)) kinds.push(kind);
          }
        }
        if (new Set(kinds).size < kinds.length) return { x, y };
      }
    }
    w.toDay();
  }
  throw new Error("no two finds of a kind lay within reach of each other for 400 days");
}

/** A resident's bounty posted by `poster` and done by `claimant`, then confirmed. Its last events. */
function bounty(
  w: World,
  poster: string,
  claimant: string,
  reward: number = PROGRESS.bountyMinReward,
) {
  fund(w.state, poster, reward);
  const posted = w
    .ok(poster, { type: "post_bounty", title: "Water my lemons", reward })
    .find((e) => e.type === "bounty_posted");
  const id = posted?.type === "bounty_posted" ? posted.bounty.id : "";
  w.ok(claimant, { type: "claim_bounty", bounty: id });
  w.ok(claimant, { type: "complete_bounty", bounty: id });
  return w.ok(poster, { type: "confirm_bounty", bounty: id, to: claimant });
}

/**
 * A Hearth race played to its end: each round every seat makes the choice `choose` gives it, or
 * none for `null`, and the round closes. The seats rated at the start, and the last round's events.
 */
function game(w: World, seats: string[], choose: (seat: string, round: number) => number | null) {
  const [first = "", ...rest] = seats;
  const opened = w
    .ok(first, { type: "open_table", game: "hearth_race", pace: "slow", salt: SALT, at: w.tick() })
    .find((e) => e.type === "table_opened");
  const table = opened?.type === "table_opened" ? opened.table : "";
  for (const seat of rest) w.ok(seat, { type: "sit", table, at: w.tick() });
  const started = w
    .ok(first, { type: "start_game", table, at: w.tick() })
    .find((e) => e.type === "game_started");
  const rated = started?.type === "game_started" ? started.rated : [];
  let events: WorldEvent[] = [];
  for (let round = 1; round <= 30 && !events.some((e) => e.type === "game_over"); round++) {
    for (const seat of seats) {
      const move = choose(seat, round);
      if (move !== null) w.ok(seat, { type: "decide", table, round, move });
    }
    events = w.town({ type: "close_round", table, round, at: w.tick() });
  }
  expect(events.some((e) => e.type === "game_over")).toBe(true);
  return { rated, events };
}

/** A Hearth race the first seat wins in four rounds. The last round's events. */
const race = (w: World, seats: string[]) =>
  game(w, seats, (seat) => (seat === seats[0] ? 3 : 2)).events;

describe("the curve", () => {
  it("matches its pinned table: level n to n + 1 takes 20 times n", () => {
    const table: [number, number][] = [
      [1, 0],
      [2, 20],
      [3, 60],
      [4, 120],
      [5, 200],
      [7, 420],
      [10, 900],
      [15, 2_100],
      [20, 3_800],
      [30, 8_700],
      [50, 24_500],
    ];
    for (const [level, total] of table) {
      expect(pointsFor(level), `level ${level}`).toBe(total);
      expect(levelOf(total), `${total} points`).toBe(level);
      if (level > 1) expect(levelOf(total - 1), `${total - 1} points`).toBe(level - 1);
    }
    // No top: the numbers keep going.
    expect(levelOf(pointsFor(200))).toBe(200);
  });
});

describe("the numbers", () => {
  it("are pinned, so a change is deliberate and comes with a run of scripts/economy-sim.ts", () => {
    expect(PROGRESS).toEqual({
      dailyCap: 20,
      first: 10,
      step: 20,
      harvest: 2,
      craft: 2,
      find: 4,
      fish: 2,
      lesson: 8,
      bounty: 6,
      bountyMinReward: 5,
      guest: 2,
      attend: 8,
      game: 6,
      win: 2,
    });
    expect(SKILLS).toEqual(["growing", "making", "foraging", "hosting", "playing"]);
    expect(UNLOCKS).toEqual({ title: 3, wear: 5, master: 10 });
  });

  it("give every skill a title at level 3, a garment at 5, and a second title at 10", () => {
    for (const skill of SKILLS) {
      const titles = TITLES.filter((title) => TITLE_INFO[title].skill === skill);
      expect(
        titles.map((title) => TITLE_INFO[title].level),
        skill,
      ).toEqual([3, 10]);
      expect(
        EARNED_WEAR.filter((wear) => EARNED_WEAR_SKILL[wear] === skill),
        skill,
      ).toHaveLength(1);
    }
    // A garment's slot decides which wear lists a logged profile may hold, so it's pinned.
    expect(EARNED_WEAR.map((wear) => [wear, EARNED_WEAR_INFO[wear].slot])).toEqual([
      ["sun_hat", "hat"],
      ["tool_belt", "accessory"],
      ["field_vest", "top"],
      ["party_sash", "accessory"],
      ["winners_rosette", "accessory"],
    ]);
    // Until the web draws them they're a list of their own, which no wear enum is built from.
    for (const wear of EARNED_WEAR) expect(WEAR_ITEMS as readonly string[]).not.toContain(wear);
  });

  it("give each kind's first to one skill, and none to what a deed never makes", () => {
    expect(firstSkill("pumpkin")).toBe("growing");
    expect(["lemon_jam", "chair", "candy", "fishing_rod"].map(firstSkill)).toEqual(
      Array(4).fill("making"),
    );
    expect(["acorn", "minnow"].map(firstSkill)).toEqual(["foraging", "foraging"]);
    for (const kind of ["wood", "stone", "lemon_seed", "sugar", "lantern", RECIPE_PAGE, "boot"]) {
      expect(firstSkill(kind), kind).toBeUndefined();
    }
    expect(firstSkill("__proto__")).toBeUndefined();
  });
});

describe("open_levels", () => {
  it("only comes from the server, once, after items", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    expect(w.code(TOWN_ACTOR, { type: "open_levels", firsts: [] })).toBe("not_due");
    w.town({ type: "open_items" });
    expect(w.code("ada", { type: "open_levels", firsts: [] })).toBe("server_only");
    expect(w.town({ type: "open_levels", firsts: [] })).toEqual([{ type: "levels_opened" }]);
    expect(w.state.progress).toEqual({ opened: DAY, points: {}, firsts: {} });
    expect(w.code(TOWN_ACTOR, { type: "open_levels", firsts: [] })).toBe("already_open");
  });

  it("changes nothing a deed does until it's logged", () => {
    const w = levels({ open: false });
    const [tile] = plant(w, "ada", "herb");
    w.toDay(OPEN + 2);
    const events = w.ok("ada", { type: "harvest", ...(tile ?? { x: 0, y: 0 }) });
    expect(events.some((e) => e.type === "harvested")).toBe(true);
    expect(progress(events)).toEqual([]);
    expect(w.state.progress).toBeUndefined();
    expect(levelsOf(w.state, "ada").level).toBe(1);
  });
});

describe("a deed earns its points once, in its skill", () => {
  it("a harvest earns Growing, with a first for a new crop, in one private event", () => {
    const w = levels();
    const tiles = plant(w, "ada", "herb", 2);
    w.toDay(OPEN + 2);
    const [first, second] = tiles.map((tile) => w.ok("ada", { type: "harvest", ...tile }));
    expect(progress(first ?? [])).toEqual([
      {
        type: "progress",
        residentId: "ada",
        skill: "growing",
        points: PROGRESS.harvest + PROGRESS.first,
        firsts: ["herb"],
        total: 12,
        today: 2,
      },
    ]);
    expect(progress(second ?? [])).toEqual([
      { type: "progress", residentId: "ada", skill: "growing", points: 2, total: 14, today: 4 },
    ]);
    expect(w.points("ada")).toEqual({ growing: 14 });
    expect(firstsOf(w.state, "ada")).toEqual(["herb"]);
    expect(w.points("bob")).toEqual({});
  });

  it("a craft earns Making: a good, a piece of furniture, and a sweet, each kind a first once", () => {
    const w = levels();
    const { bench, kitchen } = stations(w, "ada");
    stock(w.state, "ada", { wood: 4, herb: 5, jar: 1, sugar: 1 });
    const craft = (recipe: string, at: { x: number; y: number }) =>
      progress(w.ok("ada", { type: "craft", recipe, ...at } as Command)).map((e) =>
        e.type === "progress" ? [e.skill, e.points, e.firsts] : [],
      );
    expect(craft("chair", bench)).toEqual([["making", 12, ["chair"]]]);
    expect(craft("chair", bench)).toEqual([["making", 2, undefined]]);
    expect(craft("herb_tea", kitchen)).toEqual([["making", 12, ["herb_tea"]]]);
    // Five candy canes from one craft are one deed.
    expect(craft("candy_cane", kitchen)).toEqual([["making", 12, ["candy_cane"]]]);
    expect(w.points("ada")).toEqual({ making: 38 });
    expect(firstsOf(w.state, "ada")).toEqual(["candy_cane", "chair", "herb_tea"]);
  });

  it("a find earns Foraging, a recipe page too with no first, and wood and stone nothing", () => {
    const w = levels();
    const find = lying(w, isFindKind);
    w.standAt("bob", find.x, find.y);
    expect(progress(w.ok("bob", { type: "gather", x: find.x, y: find.y }))).toMatchObject([
      { skill: "foraging", points: PROGRESS.find + PROGRESS.first, firsts: [find.kind], today: 4 },
    ]);
    const page = lying(w, (kind) => kind === RECIPE_PAGE);
    const before = w.points("bob").foraging ?? 0;
    w.standAt("bob", page.x, page.y);
    const paged = progress(w.ok("bob", { type: "gather", x: page.x, y: page.y }));
    expect(paged).toMatchObject([{ skill: "foraging", points: PROGRESS.find }]);
    expect(paged[0]).not.toHaveProperty("firsts");
    expect(w.points("bob")).toEqual({ foraging: before + PROGRESS.find });
    const branch = lying(w, (kind) => kind === "wood" || kind === "stone");
    w.standAt("bob", branch.x, branch.y);
    expect(progress(w.ok("bob", { type: "gather", x: branch.x, y: branch.y }))).toEqual([]);
    expect(w.points("bob")).toEqual({ foraging: before + PROGRESS.find });
    expect(firstsOf(w.state, "bob")).toEqual([find.kind]);
  });

  it("gathering everything within reach counts each find it took, and a kind's first once", () => {
    const w = levels();
    // Somewhere two finds of one kind lie within reach of each other.
    const spot = twoOfAKind(w);
    w.standAt("bob", spot.x, spot.y);
    const events = w.ok("bob", { type: "gather" });
    const finds = events.flatMap((e) => (e.type === "gathered" && isFindKind(e.kind) ? [e] : []));
    const kinds = [...new Set(finds.map((e) => e.kind))].sort();
    expect(finds.length).toBeGreaterThan(kinds.length);
    expect(progress(events)).toMatchObject([{ skill: "foraging", firsts: kinds }]);
    expect(w.points("bob")).toEqual({
      foraging: Math.min(PROGRESS.dailyCap, finds.length * PROGRESS.find) + kinds.length * 10,
    });
    expect(firstsOf(w.state, "bob")).toEqual(kinds);
  });

  it("a fish earns Foraging, and an old boot nothing", () => {
    const w = levels();
    const { bench } = stations(w, "ada");
    stock(w.state, "ada", { wood: 3, stone: 2 });
    w.ok("ada", { type: "craft", recipe: "fishing_rod", ...bench });
    w.ok("ada", { type: "place", x: 3, y: 2, block: "pond" });
    const cast = (roll: number): Command => ({
      type: "fish",
      roll,
      weather: "clear",
      timeOfDay: "day",
    });
    // In autumn at noon in the sun, the first 500 rolls are a boot and the next 3,000 a minnow.
    expect(progress(w.ok("ada", cast(0)))).toEqual([]);
    expect(progress(w.ok("ada", cast(500)))).toMatchObject([
      { skill: "foraging", points: PROGRESS.fish + PROGRESS.first, firsts: ["minnow"], today: 2 },
    ]);
    expect(progress(w.ok("ada", cast(501)))).toMatchObject([{ skill: "foraging", points: 2 }]);
    expect(w.points("ada").foraging).toBe(14);
  });

  it("a lesson earns its teacher Hosting, and its learner nothing", () => {
    const w = levels();
    w.standAt("bob", 4, 4);
    const events = w.ok("ada", { type: "teach", recipe: "lemonade", to: "bob" });
    expect(progress(events)).toEqual([
      {
        type: "progress",
        residentId: "ada",
        skill: "hosting",
        points: PROGRESS.lesson,
        total: 8,
        today: 8,
      },
    ]);
    expect(w.points("bob")).toEqual({});
  });

  it("a lesson to someone with no hearth earns nothing", () => {
    const w = levels();
    w.ok("eve", { type: "join", name: "eve", kind: "human" });
    w.standAt("eve", 4, 4);
    expect(progress(w.ok("ada", { type: "teach", recipe: "lemonade", to: "eve" }))).toEqual([]);
    expect(w.points("ada")).toEqual({});
  });

  it("a rated game earns Playing for finishing it, and more for finishing first", () => {
    const w = levels();
    const events = race(w, ["ada", "bob"]);
    expect(progress(events)).toMatchObject([
      { residentId: "ada", skill: "playing", points: PROGRESS.game + PROGRESS.win },
      { residentId: "bob", skill: "playing", points: PROGRESS.game },
    ]);
    expect(w.points("ada")).toEqual({ playing: 8 });
    expect(w.points("bob")).toEqual({ playing: 6 });
  });

  it("a rated game nobody plays earns nothing: both seats sit, start, and never choose", () => {
    const w = levels();
    const { rated, events } = game(w, ["ada", "bob"], () => null);
    // Both seats were rated, and the defaults left them level on the board, both in first place.
    expect(rated).toEqual(["ada", "bob"]);
    const over = events.find((e) => e.type === "game_over");
    expect(over?.type === "game_over" && over.places).toEqual({ ada: 1, bob: 1 });
    expect(progress(events)).toEqual([]);
    expect(w.state.progress).toEqual(NOTHING_YET);
  });

  it("a seat that never chose earns nothing from a game the other seat played", () => {
    const w = levels();
    const { rated, events } = game(w, ["ada", "bob"], (seat) => (seat === "ada" ? 3 : null));
    expect(rated).toEqual(["ada", "bob"]);
    expect(progress(events)).toMatchObject([
      { residentId: "ada", skill: "playing", points: PROGRESS.game + PROGRESS.win },
    ]);
    expect(w.points("bob")).toEqual({});
  });

  it("nobody wins a game that ends because every seat walked away", () => {
    const w = levels();
    // Both choose in the first round and never again, so the game ends with both away.
    const { events } = game(w, ["ada", "bob"], (seat, round) =>
      round === 1 ? (seat === "ada" ? 3 : 2) : null,
    );
    const over = events.find((e) => e.type === "game_over");
    expect(over?.type === "game_over" && over.places.ada).toBe(1);
    // They played, so the game counts for both, and first place earns nothing more.
    expect(w.points("ada")).toEqual({ playing: PROGRESS.game });
    expect(w.points("bob")).toEqual({ playing: PROGRESS.game });
  });

  it("a seat that wasn't rated earns nothing, however it finished", () => {
    const w = levels();
    // Eve moved in today, so she can't vote yet and her seat isn't rated.
    w.settle("eve");
    const events = race(w, ["eve", "ada", "bob"]);
    expect(progress(events).map((e) => (e.type === "progress" ? e.residentId : ""))).toEqual([
      "ada",
      "bob",
    ]);
    expect(w.points("eve")).toEqual({});
  });

  it("says so when a level is reached, in the skill and for the resident", () => {
    const w = levels();
    const tiles = plant(w, "ada", "herb", 8);
    w.toDay(OPEN + 2);
    const events = tiles.map((tile) => w.ok("ada", { type: "harvest", ...tile }));
    // 12, then 2 each: the fifth harvest makes 20, which is level 2.
    expect(events.slice(0, 4).flatMap(reached)).toEqual([]);
    expect(events.slice(5).flatMap(reached)).toEqual([]);
    expect(reached(events[4] ?? [])).toEqual([
      { type: "level_reached", residentId: "ada", skill: "growing", level: 2 },
      { type: "level_reached", residentId: "ada", level: 2 },
    ]);
    expect(levelsOf(w.state, "ada")).toEqual({
      level: 2,
      skills: { growing: 2, making: 1, foraging: 1, hosting: 1, playing: 1 },
    });
  });
});

describe("the daily cap", () => {
  it("counts 20 points a skill a day: the 11th harvest adds nothing, and new_day starts again", () => {
    const w = levels();
    const herbs = plant(w, "ada", "herb", 12);
    const [flower] = plant(w, "ada", "flower", 1, 12);
    w.toDay(OPEN + 2);
    for (const tile of herbs.slice(0, 10)) w.ok("ada", { type: "harvest", ...tile });
    expect(w.points("ada")).toEqual({ growing: PROGRESS.dailyCap + PROGRESS.first });
    expect(w.state.progress?.today).toEqual({ ada: { growing: PROGRESS.dailyCap } });
    // The deed still happens: the crop comes up, and nothing is said about points.
    const eleventh = w.ok("ada", { type: "harvest", ...(herbs[10] ?? { x: 0, y: 0 }) });
    expect(eleventh.some((e) => e.type === "harvested")).toBe(true);
    expect(progress(eleventh)).toEqual([]);
    expect(w.points("ada")).toEqual({ growing: 30 });
    // A first sits outside the cap, and counts nothing toward it.
    const flowers = w.ok("ada", { type: "harvest", ...(flower ?? { x: 0, y: 0 }) });
    expect(progress(flowers)).toMatchObject([
      { skill: "growing", points: PROGRESS.first, firsts: ["flower"], total: 40, today: 20 },
    ]);
    // Another skill has its own cap.
    w.standAt("bob", 4, 4);
    w.ok("ada", { type: "teach", recipe: "lemonade", to: "bob" });
    expect(w.points("ada")).toEqual({ growing: 40, hosting: 8 });
    w.toDay();
    expect(w.state.progress?.today).toBeUndefined();
    w.ok("ada", { type: "harvest", ...(herbs[11] ?? { x: 0, y: 0 }) });
    expect(w.points("ada")).toEqual({ growing: 42, hosting: 8 });
    expect(w.state.progress?.today).toEqual({ ada: { growing: 2 } });
  });

  it("counts a deed only up to what's left of the cap", () => {
    const w = levels();
    // Three counted bounties are 18 points, so a lesson's 8 has room for 2.
    for (const poster of ["bob", "cy", "dee"]) bounty(w, poster, "ada");
    w.standAt("bob", 4, 4);
    const events = w.ok("ada", { type: "teach", recipe: "lemonade", to: "bob" });
    expect(progress(events)).toMatchObject([{ skill: "hosting", points: 2, total: 20, today: 20 }]);
  });
});

describe("firsts", () => {
  it("count once per kind and resident, whoever else had one", () => {
    const w = levels();
    const mine = plant(w, "ada", "herb", 2);
    const theirs = plant(w, "bob", "herb", 1);
    w.toDay(OPEN + 2);
    for (const tile of mine) w.ok("ada", { type: "harvest", ...tile });
    for (const tile of theirs) w.ok("bob", { type: "harvest", ...tile });
    expect(w.points("ada")).toEqual({ growing: 14 });
    expect(w.points("bob")).toEqual({ growing: 12 });
    // The same kind days later is no first.
    const again = plant(w, "ada", "herb", 1, 2);
    w.toDay(OPEN + 4);
    for (const tile of again) w.ok("ada", { type: "harvest", ...tile });
    expect(w.points("ada")).toEqual({ growing: 16 });
    expect(firstsOf(w.state, "ada")).toEqual(["herb"]);
  });
});

describe("what never earns", () => {
  it("a lesson, a bounty, and a game inside a household add nothing", () => {
    const w = levels();
    w.town({ type: "add_owner_pair", pair: ["ada", "bob"] });
    w.standAt("bob", 4, 4);
    expect(progress(w.ok("ada", { type: "teach", recipe: "lemonade", to: "bob" }))).toEqual([]);
    expect(progress(bounty(w, "bob", "ada"))).toEqual([]);
    // Seats from one household are unrated, and with them out Cy has nobody to be rated against.
    expect(progress(race(w, ["ada", "bob", "cy"]))).toEqual([]);
    expect(w.state.progress).toEqual(NOTHING_YET);
  });

  it("two AIs of one person are one household too", () => {
    const w = levels();
    w.town({
      type: "set_owner_pairs",
      pairs: [
        ["ada", "bob"],
        ["ada", "cy"],
      ],
    });
    expect(progress(bounty(w, "bob", "cy"))).toEqual([]);
    expect(progress(bounty(w, "dee", "cy"))).toHaveLength(1);
  });

  it("townsfolk never earn, for a deed of their own or a lesson they give", () => {
    const w = levels();
    const [tile] = plant(w, "cy", "herb");
    w.town({ type: "set_townsfolk", ids: ["cy"] });
    w.toDay(OPEN + 2);
    expect(progress(w.ok("cy", { type: "harvest", ...(tile ?? { x: 0, y: 0 }) }))).toEqual([]);
    w.standAt("bob", 4, 20);
    expect(progress(w.ok("cy", { type: "teach", recipe: "lemonade", to: "bob" }))).toEqual([]);
    expect(w.state.progress).toEqual(NOTHING_YET);
  });

  it("a routine's step and a refused input add nothing", () => {
    const w = levels();
    const [tile] = plant(w, "ada", "herb");
    // Refused: the herbs aren't ready. `send` checks the world's hash didn't move.
    expect(w.code("ada", { type: "harvest", ...(tile ?? { x: 0, y: 0 }) })).toBe("not_ready");
    w.ok("ada", { type: "set_routines", routines: [{ kind: "walk_home", hour: 1 }] });
    w.ok("ada", { type: "move", dir: "s" });
    w.ok("ada", { type: "leave" });
    const before = canonicalJson(w.state.progress);
    w.town({ type: "routine_step", resident: "ada", routine: "walk_home", step: { type: "home" } });
    expect(canonicalJson(w.state.progress)).toBe(before);
    expect(w.state.progress).toEqual(NOTHING_YET);
  });

  it("coins, gifts, and things bought add nothing", () => {
    const w = levels();
    fund(w.state, "ada", 50);
    stock(w.state, "ada", { lemon: 3 });
    w.toDay();
    w.ok("ada", { type: "give_coins", to: "bob", amount: 5 });
    w.ok("ada", { type: "give", item: "lemon", to: "bob" });
    w.ok("ada", { type: "shop_buy", sku: "lantern" });
    expect(w.state.progress).toEqual(NOTHING_YET);
  });
});

describe("a bounty", () => {
  it("earns its claimant Hosting when a neighbor who could vote pays 5 coins or more", () => {
    const w = levels();
    expect(progress(bounty(w, "dee", "ada"))).toEqual([
      {
        type: "progress",
        residentId: "ada",
        skill: "hosting",
        points: PROGRESS.bounty,
        total: 6,
        today: 6,
      },
    ]);
    expect(w.points("dee")).toEqual({});
    expect(w.state.progress?.week).toEqual({ start: weekStart(OPEN), bounties: { ada: ["dee"] } });
  });

  it("under 5 coins adds nothing", () => {
    const w = levels();
    expect(progress(bounty(w, "dee", "ada", PROGRESS.bountyMinReward - 1))).toEqual([]);
    expect(w.state.progress).toEqual(NOTHING_YET);
  });

  it("from a poster who couldn't vote adds nothing", () => {
    const w = levels();
    w.settle("eve");
    // Past her first day, when nobody posts, and two days short of holding her plot long enough.
    w.toDay();
    expect(progress(bounty(w, "eve", "ada"))).toEqual([]);
    expect(w.state.progress).toEqual(NOTHING_YET);
    // Once she could vote, the same deal counts.
    w.toDay(OPEN + 3);
    expect(progress(bounty(w, "eve", "ada"))).toHaveLength(1);
  });

  it("from the same poster twice in a UTC week adds nothing, and counts again the week after", () => {
    const w = levels();
    bounty(w, "dee", "ada");
    w.toDay();
    expect(progress(bounty(w, "dee", "ada"))).toEqual([]);
    // Another poster the same week counts, and so does the same poster for another claimant.
    expect(progress(bounty(w, "cy", "ada"))).toHaveLength(1);
    expect(progress(bounty(w, "dee", "bob"))).toHaveLength(1);
    expect(w.state.progress?.week?.bounties).toEqual({ ada: ["cy", "dee"], bob: ["dee"] });
    expect(w.points("ada")).toEqual({ hosting: 12 });
    // The week's pairs start again with the first counted bounty of a later week.
    w.toDay(OPEN + 7);
    expect(progress(bounty(w, "dee", "ada"))).toHaveLength(1);
    expect(w.state.progress?.week).toEqual({
      start: weekStart(OPEN + 7),
      bounties: { ada: ["dee"] },
    });
  });

  it("paid while Hosting is at its cap adds nothing and doesn't use up the pair's week: the next one counts", () => {
    const w = levels();
    // A lesson's 8 and two bounties' 12 fill Ada's Hosting for the day.
    w.standAt("bob", 4, 4);
    w.ok("ada", { type: "teach", recipe: "lemonade", to: "bob" });
    bounty(w, "bob", "ada");
    bounty(w, "cy", "ada");
    expect(w.points("ada")).toEqual({ hosting: PROGRESS.dailyCap });
    expect(progress(bounty(w, "dee", "ada"))).toEqual([]);
    expect(w.state.progress?.week?.bounties).toEqual({ ada: ["bob", "cy"] });
    // The next day, in the same week, Dee's bounty counts: her pair with Ada hasn't counted yet.
    w.toDay();
    expect(progress(bounty(w, "dee", "ada"))).toMatchObject([{ points: PROGRESS.bounty }]);
    expect(w.state.progress?.week?.bounties).toEqual({ ada: ["bob", "cy", "dee"] });
    expect(progress(bounty(w, "dee", "ada"))).toEqual([]);
  });

  it("from the town counts every time, whatever it pays", () => {
    const w = levels();
    w.ok("ada", {
      type: "propose",
      kind: "bounty",
      title: "A bridge across the stream",
      text: "",
      amount: 2,
    });
    const proposal = w.state.town?.proposals.at(-1);
    for (const name of ["bob", "cy", "dee"]) {
      w.ok(name, { type: "vote", proposal: proposal?.id ?? "", choice: "yes" });
    }
    w.toDay(proposal?.closesDay);
    w.town({ type: "close_proposal", proposal: proposal?.id ?? "" });
    const id = w.state.bounties?.list.at(-1)?.id ?? "";
    w.ok("bob", { type: "claim_bounty", bounty: id });
    w.ok("bob", { type: "complete_bounty", bounty: id });
    const paid = w.town({
      type: "confirm_town_bounty",
      bounty: id,
      to: "bob",
      by: "staff_0123456789ab",
    });
    expect(progress(paid)).toMatchObject([
      { residentId: "bob", skill: "hosting", points: PROGRESS.bounty },
    ]);
    // A town bounty is in nobody's week: the pair rule is for deals between residents.
    expect(w.state.progress?.week).toBeUndefined();
  });
});

describe("the one-time credit", () => {
  const credit: FirstsCredit[] = [
    { resident: "ada", kinds: ["minnow", "lemon", "chair", "acorn"] },
    { resident: "bob", kinds: ["herb"] },
  ];

  it("counts each listed kind as a first in its skill, toward no day's cap and no season", () => {
    const w = levels({ open: false });
    const events = w.town({ type: "open_levels", firsts: credit });
    expect(events).toEqual([
      { type: "levels_opened" },
      {
        type: "progress",
        residentId: "ada",
        skill: "growing",
        points: 10,
        firsts: ["lemon"],
        total: 10,
        today: 0,
      },
      {
        type: "progress",
        residentId: "ada",
        skill: "making",
        points: 10,
        firsts: ["chair"],
        total: 10,
        today: 0,
      },
      {
        type: "progress",
        residentId: "ada",
        skill: "foraging",
        points: 20,
        firsts: ["acorn", "minnow"],
        total: 20,
        today: 0,
      },
      { type: "level_reached", residentId: "ada", skill: "foraging", level: 2 },
      { type: "level_reached", residentId: "ada", level: 2 },
      {
        type: "progress",
        residentId: "bob",
        skill: "growing",
        points: 10,
        firsts: ["herb"],
        total: 10,
        today: 0,
      },
    ]);
    expect(w.state.progress).toEqual({
      opened: OPEN,
      points: { ada: { growing: 10, making: 10, foraging: 20 }, bob: { growing: 10 } },
      firsts: { ada: ["acorn", "chair", "lemon", "minnow"], bob: ["herb"] },
    });
  });

  it("makes a credited kind no first when its resident does it again", () => {
    const w = levels({ firsts: credit });
    const tiles = plant(w, "bob", "herb", 1);
    w.toDay(OPEN + 2);
    const events = w.ok("bob", { type: "harvest", ...(tiles[0] ?? { x: 0, y: 0 }) });
    expect(progress(events)).toMatchObject([{ points: PROGRESS.harvest, total: 12 }]);
    expect(progress(events)[0]).not.toHaveProperty("firsts");
  });

  it("runs once: a second open_levels is refused and credits nobody", () => {
    const w = levels({ firsts: credit });
    const before = canonicalJson(w.state.progress);
    expect(w.code(TOWN_ACTOR, { type: "open_levels", firsts: credit })).toBe("already_open");
    expect(
      w.code(TOWN_ACTOR, { type: "open_levels", firsts: [{ resident: "cy", kinds: ["herb"] }] }),
    ).toBe("already_open");
    expect(canonicalJson(w.state.progress)).toBe(before);
  });

  it("is refused whole when any entry is wrong, leaving levels closed", () => {
    const w = levels({ open: false });
    w.town({ type: "set_townsfolk", ids: ["dee"] });
    const open = (firsts: unknown) =>
      w.code(TOWN_ACTOR, { type: "open_levels", firsts } as unknown as Command);
    const good = { resident: "ada", kinds: ["lemon"] };
    expect(open(undefined)).toBe("unknown_resident");
    expect(open({ ada: ["lemon"] })).toBe("unknown_resident");
    expect(open([good, null])).toBe("unknown_resident");
    expect(open([good, { resident: "nobody", kinds: ["lemon"] }])).toBe("unknown_resident");
    expect(open([good, { resident: "__proto__", kinds: ["lemon"] }])).toBe("unknown_resident");
    expect(open([good, { resident: "ada", kinds: ["herb"] }])).toBe("unknown_resident");
    expect(open([good, { resident: "dee", kinds: ["lemon"] }])).toBe("not_eligible");
    expect(open([good, { resident: "bob", kinds: [] }])).toBe("unknown_item");
    expect(open([good, { resident: "bob" }])).toBe("unknown_item");
    for (const kind of ["wood", "lemon_seed", "lantern", "straw_hat", "__proto__", 7, null]) {
      expect(open([good, { resident: "bob", kinds: ["herb", kind] }]), String(kind)).toBe(
        "unknown_item",
      );
    }
    expect(open([good, { resident: "bob", kinds: ["herb", "herb"] }])).toBe("unknown_item");
    expect(w.state.progress).toBeUndefined();
    expect(open([good])).toBeNull();
  });

  it("names the level a resident lands on once, however many they passed", () => {
    const w = levels({ open: false });
    const crops = ["lemon", "strawberry", "tomato", "herb", "flower", "pumpkin", "pomegranate"];
    const events = w.town({
      type: "open_levels",
      firsts: [{ resident: "ada", kinds: [...crops, "cranberry"] }],
    });
    // 80 points: past level 2's 20 and level 3's 60 at once.
    expect(reached(events)).toEqual([
      { type: "level_reached", residentId: "ada", skill: "growing", level: 3 },
      { type: "level_reached", residentId: "ada", level: 3 },
    ]);
  });
});

describe("season points", () => {
  it("are counted beside the total, each season under its first day, from the day levels open", () => {
    const w = levels({ firsts: [{ resident: "ada", kinds: ["lemon"] }] });
    expect(w.state.progress?.seasons).toBeUndefined();
    const autumn = String(dayOfDate(2024, 9, 1));
    const winter = String(dayOfDate(2024, 12, 1));
    const herbs = plant(w, "ada", "herb", 2);
    w.toDay(OPEN + 2);
    w.ok("ada", { type: "harvest", ...(herbs[0] ?? { x: 0, y: 0 }) });
    expect(w.state.progress?.seasons).toEqual({ [autumn]: { ada: { growing: 12 } } });
    w.standAt("bob", 4, 4);
    w.ok("ada", { type: "teach", recipe: "lemonade", to: "bob" });
    w.toDay(dayOfDate(2024, 12, 3));
    w.ok("ada", { type: "harvest", ...(herbs[1] ?? { x: 0, y: 0 }) });
    expect(w.state.progress?.seasons).toEqual({
      [autumn]: { ada: { growing: 12, hosting: 8 } },
      [winter]: { ada: { growing: 2 } },
    });
    // The total has the credit too; the seasons never do.
    expect(w.points("ada")).toEqual({ growing: 24, hosting: 8 });
  });
});

const HOUR = 3_600_000;

/**
 * An event on `host`'s plot today that `guests` attend: scheduled for `hour` o'clock, started,
 * sampled twice with the guests standing on the plot, and ended. Its id.
 */
function party(w: World, host: string, guests: string[], hour = 12) {
  const [px, py] = PLOTS[host] ?? [0, 0];
  const scheduled = w
    .ok(host, {
      type: "schedule_event",
      kind: "gathering",
      title: "Tea",
      px,
      py,
      startsAt: w.day() * 24 * HOUR + hour * HOUR,
      minutes: 30,
    })
    .find((e) => e.type === "event_scheduled");
  const event = scheduled?.type === "event_scheduled" ? scheduled.event : "";
  w.town({ type: "event_start", event });
  // East of the hut, outside its wall, one tile each.
  guests.forEach((guest, i) => {
    w.standAt(guest, px * 8 + 6, py * 8 + 1 + i);
  });
  w.town({ type: "event_tick", event, slot: 1 });
  w.town({ type: "event_tick", event, slot: 2 });
  w.town({ type: "event_end", event });
  return event;
}

const credit = (event: string, guests: unknown): Command =>
  ({ type: "credit_event", event, guests }) as Command;

describe("credit_event", () => {
  it("gives the host 2 a counted guest and each guest 8, once", () => {
    const w = levels();
    const event = party(w, "ada", ["bob", "cy"]);
    expect(w.state.events?.list[0]?.attended).toEqual(["bob", "cy"]);
    expect(w.town(credit(event, ["cy", "bob"]))).toEqual([
      { type: "event_credited", event, guests: ["cy", "bob"] },
      { type: "progress", residentId: "ada", skill: "hosting", points: 4, total: 4, today: 4 },
      { type: "progress", residentId: "cy", skill: "hosting", points: 8, total: 8, today: 8 },
      { type: "progress", residentId: "bob", skill: "hosting", points: 8, total: 8, today: 8 },
    ]);
    expect(w.state.progress?.hostedToday).toEqual(["ada"]);
    expect(w.state.progress?.guestToday).toEqual(["bob", "cy"]);
    expect(w.state.events?.list[0]?.credited).toBe(true);
    expect(w.code(TOWN_ACTOR, credit(event, ["bob", "cy"]))).toBe("already_set");
    expect(w.code(TOWN_ACTOR, credit(event, []))).toBe("already_set");
    expect(w.points("ada")).toEqual({ hosting: 4 });
  });

  it("takes a shorter list than the sim saw attend, and never a longer one", () => {
    const w = levels();
    const event = party(w, "ada", ["bob", "cy"]);
    // Dee never came, and the host is no guest of her own event.
    expect(w.code(TOWN_ACTOR, credit(event, ["bob", "dee"]))).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, credit(event, ["ada"]))).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, credit(event, ["nobody"]))).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, credit(event, ["__proto__"]))).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, credit(event, ["cy", "cy"]))).toBe("invalid_event");
    expect(w.code(TOWN_ACTOR, credit(event, "bob"))).toBe("invalid_event");
    expect(w.code(TOWN_ACTOR, credit(event, [7]))).toBe("invalid_event");
    expect(w.code(TOWN_ACTOR, credit("e_9", ["bob"]))).toBe("unknown_event");
    expect(w.code(TOWN_ACTOR, credit("__proto__", ["bob"]))).toBe("unknown_event");
    expect(w.code("ada", credit(event, ["bob"]))).toBe("server_only");
    // The server left Cy out, so only Bob counts.
    const events = w.town(credit(event, ["bob"]));
    expect(progress(events).map((e) => (e.type === "progress" ? e.residentId : ""))).toEqual([
      "ada",
      "bob",
    ]);
    expect(w.points("ada")).toEqual({ hosting: PROGRESS.guest });
    expect(w.points("cy")).toEqual({});
  });

  it("refuses a guest in the host's household, though the sim saw them attend", () => {
    const w = levels();
    const event = party(w, "ada", ["bob", "cy"]);
    w.town({ type: "add_owner_pair", pair: ["ada", "bob"] });
    expect(w.state.events?.list[0]?.attended).toContain("bob");
    expect(w.code(TOWN_ACTOR, credit(event, ["bob", "cy"]))).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, credit(event, ["cy"]))).toBeNull();
  });

  it("refuses townsfolk as guests, even ones who attended before they were townsfolk", () => {
    const w = levels();
    const event = party(w, "ada", ["bob", "cy"]);
    w.town({ type: "set_townsfolk", ids: ["cy"] });
    expect(w.state.events?.list[0]?.attended).toContain("cy");
    expect(w.code(TOWN_ACTOR, credit(event, ["bob", "cy"]))).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, credit(event, ["bob"]))).toBeNull();
  });

  it("waits for the event to end, and for levels to open", () => {
    const w = levels();
    const scheduled = w
      .ok("ada", {
        type: "schedule_event",
        kind: "gathering",
        title: "Tea",
        px: 0,
        py: 0,
        startsAt: w.day() * 24 * HOUR + 12 * HOUR,
        minutes: 30,
      })
      .find((e) => e.type === "event_scheduled");
    const event = scheduled?.type === "event_scheduled" ? scheduled.event : "";
    expect(w.code(TOWN_ACTOR, credit(event, []))).toBe("not_due");
    w.town({ type: "event_start", event });
    expect(w.code(TOWN_ACTOR, credit(event, []))).toBe("not_due");
    const closed = levels({ open: false });
    expect(closed.code(TOWN_ACTOR, credit(party(closed, "ada", ["bob"]), ["bob"]))).toBe("not_due");
  });

  it("refuses an event that ended before the day levels opened", () => {
    const w = levels({ open: false });
    const before = party(w, "ada", ["bob"]);
    w.toDay();
    w.town({ type: "open_levels", firsts: [] });
    expect(w.state.progress?.opened).toBe(OPEN + 1);
    expect(w.code(TOWN_ACTOR, credit(before, ["bob"]))).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, credit(before, []))).toBe("not_eligible");
    // One that ends on the day they opened counts.
    const after = party(w, "cy", ["bob"]);
    expect(progress(w.town(credit(after, ["bob"])))).toHaveLength(2);
  });

  it("counts a host for one event a day and a guest once a day, and both again the next day", () => {
    const w = levels();
    const first = party(w, "ada", ["bob"], 12);
    const second = party(w, "ada", ["bob", "dee"], 14);
    w.town(credit(first, ["bob"]));
    // Ada hosted already today and Bob was a guest already, so only Dee earns here.
    const events = w.town(credit(second, ["bob", "dee"]));
    expect(progress(events)).toMatchObject([{ residentId: "dee", points: PROGRESS.attend }]);
    expect(w.points("ada")).toEqual({ hosting: PROGRESS.guest });
    expect(w.points("bob")).toEqual({ hosting: PROGRESS.attend });
    // Another host the same day is counted for both of her guests, Bob too.
    const third = party(w, "cy", ["bob", "dee"], 16);
    expect(progress(w.town(credit(third, ["bob", "dee"])))).toMatchObject([
      { residentId: "cy", points: 2 * PROGRESS.guest },
    ]);
    expect(w.state.progress?.hostedToday).toEqual(["ada", "cy"]);
    expect(w.state.progress?.guestToday).toEqual(["bob", "dee"]);
    w.toDay();
    expect(w.state.progress?.hostedToday).toBeUndefined();
    expect(w.state.progress?.guestToday).toBeUndefined();
    const fourth = party(w, "ada", ["bob"], 12);
    w.town(credit(fourth, ["bob"]));
    expect(w.points("ada")).toEqual({ hosting: 2 * PROGRESS.guest });
    expect(w.points("bob")).toEqual({ hosting: 2 * PROGRESS.attend });
  });

  it("gives a town event's guests their points, and nobody a host's", () => {
    const w = levels();
    const scheduled = w
      .town({
        type: "schedule_town_event",
        key: "harvest-night",
        kind: "gathering",
        title: "Harvest night",
        startsAt: w.day() * 24 * HOUR + 18 * HOUR,
        minutes: 60,
      })
      .find((e) => e.type === "event_scheduled");
    const event = scheduled?.type === "event_scheduled" ? scheduled.event : "";
    w.town({ type: "event_start", event });
    w.standAt("bob", 12, 12);
    for (const slot of [1, 2, 3, 4]) w.town({ type: "event_tick", event, slot });
    w.town({ type: "event_end", event });
    expect(progress(w.town(credit(event, ["bob"])))).toMatchObject([
      { residentId: "bob", skill: "hosting", points: PROGRESS.attend },
    ]);
    expect(w.state.progress?.hostedToday).toBeUndefined();
  });
});

/** Set a skill's points straight in the world, for a level a few deeds can't land on exactly. */
function setPoints(state: WorldState, id: string, skill: Skill, points: number) {
  const progress = state.progress;
  if (!progress) throw new Error("open levels first");
  progress.points[id] = { ...progress.points[id], [skill]: points };
}

/** What an input's events say about a profile and its title, leaving the day's allowance out. */
const shown = (events: WorldEvent[]) =>
  events.filter((e) => e.type === "profile_changed" || e.type === "title_changed");

describe("a title", () => {
  it("is refused one point short of its level, and shown from the level on", () => {
    const w = levels();
    setPoints(w.state, "ada", "growing", pointsFor(UNLOCKS.title) - 1);
    expect(w.code("ada", { type: "profile", title: "gardener" })).toBe("not_earned");
    setPoints(w.state, "ada", "growing", pointsFor(UNLOCKS.title));
    // Nothing about the profile changed, so there's no `profile_changed`.
    expect(shown(w.ok("ada", { type: "profile", title: "gardener" }))).toEqual([
      { type: "title_changed", residentId: "ada", title: "gardener" },
    ]);
    expect(titleOf(w.state, "ada")).toBe("gardener");
    expect(w.state.progress?.titles).toEqual({ ada: "gardener" });
    // Titles are kept with levels, never on the resident, so a `joined` never carries one.
    expect(w.state.residents.ada).not.toHaveProperty("title");
  });

  it("is one you reached, in the skill it belongs to", () => {
    const w = levels();
    setPoints(w.state, "ada", "growing", pointsFor(UNLOCKS.master) - 1);
    expect(w.code("ada", { type: "profile", title: "maker" })).toBe("not_earned");
    expect(w.code("ada", { type: "profile", title: "master_gardener" })).toBe("not_earned");
    expect(w.code("ada", { type: "profile", title: "wizard" } as unknown as Command)).toBe(
      "invalid_profile",
    );
    expect(w.code("ada", { type: "profile", title: "__proto__" } as unknown as Command)).toBe(
      "invalid_profile",
    );
    // Someone else's points are theirs.
    expect(w.code("bob", { type: "profile", title: "gardener" })).toBe("not_earned");
    setPoints(w.state, "ada", "growing", pointsFor(UNLOCKS.master));
    w.ok("ada", { type: "profile", title: "master_gardener" });
    // You show one at a time, from any you've reached.
    w.ok("ada", { type: "profile", title: "gardener" });
    expect(w.state.progress?.titles).toEqual({ ada: "gardener" });
  });

  it("changes with the rest of a profile in one input, and null shows none", () => {
    const w = levels();
    setPoints(w.state, "ada", "hosting", pointsFor(UNLOCKS.title));
    const events = w.ok("ada", { type: "profile", title: "host", note: "Come by for tea." });
    expect(shown(events).map((e) => e.type)).toEqual(["profile_changed", "title_changed"]);
    // The same title again is nothing to change.
    expect(w.code("ada", { type: "profile", title: "host" })).toBe("invalid_profile");
    expect(shown(w.ok("ada", { type: "profile", title: null }))).toEqual([
      { type: "title_changed", residentId: "ada", title: null },
    ]);
    expect(w.state.progress?.titles).toBeUndefined();
    expect(w.code("ada", { type: "profile", title: null })).toBe("invalid_profile");
  });

  it("is nobody's before levels open", () => {
    const w = levels({ open: false });
    expect(w.code("ada", { type: "profile", title: "gardener" })).toBe("not_earned");
    expect(w.code("ada", { type: "profile", title: null })).toBe("invalid_profile");
  });
});

describe("earned wear", () => {
  const wear = (...items: string[]): Command => ({ type: "profile", wear: items }) as Command;

  it("is refused one point short of its skill's level 5, and worn from the level on", () => {
    const w = levels();
    setPoints(w.state, "ada", "making", pointsFor(UNLOCKS.wear) - 1);
    expect(w.code("ada", wear("tool_belt"))).toBe("not_earned");
    setPoints(w.state, "ada", "making", pointsFor(UNLOCKS.wear));
    w.ok("ada", wear("tool_belt", "straw_hat"));
    expect(w.state.residents.ada?.wear).toEqual(["straw_hat", "tool_belt"]);
    // Another skill's garment is still to earn, and someone else's points are theirs.
    expect(w.code("ada", wear("sun_hat"))).toBe("not_earned");
    expect(w.code("bob", wear("tool_belt"))).toBe("not_earned");
  });

  it("takes a slot like any wear: one hat, one accessory", () => {
    const w = levels();
    for (const skill of SKILLS) setPoints(w.state, "ada", skill, pointsFor(UNLOCKS.wear));
    expect(w.code("ada", wear("sun_hat", "straw_hat"))).toBe("invalid_profile");
    expect(w.code("ada", wear("tool_belt", "party_sash"))).toBe("invalid_profile");
    w.ok("ada", wear("winners_rosette", "field_vest", "sun_hat"));
    expect(w.state.residents.ada?.wear).toEqual(["sun_hat", "field_vest", "winners_rosette"]);
    // It takes no style of its own until the web draws it.
    expect(
      w.code("ada", { type: "profile", wearStyle: { sun_hat: { color: "sun" } } } as Command),
    ).toBe("invalid_profile");
  });

  it("is checked when a resident joins, too", () => {
    const w = levels();
    setPoints(w.state, "ada", "growing", pointsFor(UNLOCKS.wear));
    w.ok("ada", { type: "leave" });
    w.ok("bob", { type: "leave" });
    const join = (name: string, ...items: string[]): Command =>
      ({ type: "join", name, kind: "human", wear: items }) as Command;
    expect(w.code("bob", join("bob", "sun_hat"))).toBe("not_earned");
    expect(w.code("ada", join("ada", "tool_belt"))).toBe("not_earned");
    w.ok("ada", join("ada", "sun_hat"));
    expect(w.state.residents.ada?.wear).toEqual(["sun_hat"]);
  });

  it("is nobody's before levels open", () => {
    const w = levels({ open: false });
    expect(w.code("ada", wear("sun_hat"))).toBe("not_earned");
  });
});

describe("merge_resident", () => {
  const MERGE = MERGE_LOG.findIndex((i) => i.command.type === "merge_resident");
  const FROM = "r_blaze4";
  const INTO = "r_blaze";
  const send = (state: WorldState, command: Command) => {
    const result = apply(state, { actor: TOWN_ACTOR, command });
    expectSupplyHolds(state);
    return result.ok ? result.events : [];
  };

  it("adds the duplicate's points skill by skill and joins their firsts", () => {
    const state = replay(MERGE_CONFIG, MERGE_LOG.slice(0, MERGE));
    send(state, {
      type: "open_levels",
      firsts: [
        { resident: FROM, kinds: ["lemon", "strawberry", "tomato", "flower", "chair"] },
        { resident: INTO, kinds: ["lemon", "herb"] },
      ],
    });
    const progress = state.progress;
    if (!progress) throw new Error("levels didn't open");
    // What only counts toward a day or a week, the season's points, and the title it showed.
    progress.seasons = { "19967": { [FROM]: { growing: 4 }, [INTO]: { growing: 2, making: 2 } } };
    progress.today = { [FROM]: { growing: 4 } };
    progress.hostedToday = [FROM];
    progress.guestToday = [FROM, "ada"];
    progress.week = { start: 20_024, bounties: { [FROM]: ["ada"], ada: [FROM] } };
    progress.titles = { [FROM]: "gardener" };
    const events = send(state, { type: "merge_resident", from: FROM, into: INTO });
    expect(events.filter((e) => e.type === "progress" || e.type === "level_reached")).toEqual([
      {
        type: "progress",
        residentId: INTO,
        skill: "growing",
        points: 40,
        // The lemon was a first for both, so it isn't one again.
        firsts: ["flower", "strawberry", "tomato"],
        total: 60,
        today: 0,
      },
      {
        type: "progress",
        residentId: INTO,
        skill: "making",
        points: 10,
        firsts: ["chair"],
        total: 10,
        today: 0,
      },
      { type: "level_reached", residentId: INTO, skill: "growing", level: 3 },
      { type: "level_reached", residentId: INTO, level: 3 },
    ]);
    expect(state.progress).toEqual({
      opened: state.day,
      points: { [INTO]: { growing: 60, making: 10 } },
      firsts: { [INTO]: ["chair", "flower", "herb", "lemon", "strawberry", "tomato"] },
      seasons: { "19967": { [INTO]: { growing: 6, making: 2 } } },
      guestToday: ["ada"],
      // History that names the duplicate stays as it was.
      week: { start: 20_024, bounties: { ada: [FROM] } },
    });
  });

  it("moves nothing in a world without levels", () => {
    const state = replay(MERGE_CONFIG, MERGE_LOG.slice(0, MERGE));
    const events = send(state, { type: "merge_resident", from: FROM, into: INTO });
    expect(events.some((e) => e.type === "resident_merged")).toBe(true);
    expect(state.progress).toBeUndefined();
  });
});

describe("retire_repeat_joins", () => {
  it("treats a record with points as used, and refuses the list", () => {
    const RETIRE = REPEAT_JOINS_LOG.findIndex((i) => i.command.type === "retire_repeat_joins");
    const listed = REPEAT_JOINS_LOG[RETIRE]?.command as Command;
    const world = () => replay(REPEAT_JOINS_CONFIG, REPEAT_JOINS_LOG.slice(0, RETIRE));
    const open = (state: WorldState, firsts: FirstsCredit[]) =>
      apply(state, { actor: TOWN_ACTOR, command: { type: "open_levels", firsts } });
    const credited = world();
    expect(open(credited, [{ resident: "r_pip2", kinds: ["lemon"] }]).ok).toBe(true);
    const before = hashWorld(credited);
    expect(apply(credited, { actor: TOWN_ACTOR, command: listed })).toMatchObject({
      rejection: { code: "not_eligible" },
    });
    expect(hashWorld(credited)).toBe(before);
    // With levels open and nothing credited to them, the same list goes.
    const untouched = world();
    expect(open(untouched, [{ resident: "r_pip", kinds: ["lemon"] }]).ok).toBe(true);
    expect(apply(untouched, { actor: TOWN_ACTOR, command: listed }).ok).toBe(true);
  });
});

describe("the levels fixture", () => {
  it("replays a credit, deeds, a bounty week, a game, an event, a title, a merge, and two seasons to the pinned hash", () => {
    const state = replay(LEVELS_CONFIG, LEVELS_LOG);
    expectSupplyHolds(state);
    expect(state.progress?.points).toEqual({
      eve: { growing: 26, making: 34, foraging: 26, hosting: 2, playing: 8 },
      ada: { growing: 10, making: 250 },
      dee: { hosting: 22, playing: 6 },
      // Fran's acorn, since her record was merged into his.
      gus: { foraging: 14 },
    });
    expect(state.progress?.titles).toEqual({ ada: "maker" });
    expect(state.residents.ada?.wear).toEqual(["tool_belt"]);
    expect(levelsOf(state, "eve")).toEqual({
      level: 3,
      skills: { growing: 2, making: 2, foraging: 2, hosting: 1, playing: 1 },
    });
    expect(Object.keys(state.progress?.seasons ?? {})).toEqual([
      String(dayOfDate(2024, 9, 1)),
      String(dayOfDate(2024, 12, 1)),
    ]);
    expect(hashWorld(state)).toBe(LEVELS_HASH);
  });
});
