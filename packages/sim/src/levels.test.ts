import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import type { Crop } from "./catalog";
import { LEVELS_CONFIG, LEVELS_HASH, LEVELS_LOG } from "./fixtures/levels-log";
import { pickupLeft, RECIPE_PAGE } from "./gather";
import { canonicalJson, hashWorld } from "./hash";
import { isFindKind } from "./items";
import { firstSkill, firstsOf, levelOf, levelsOf, PROGRESS, pointsFor, pointsOf } from "./levels";
import { replay } from "./replay";
import { dayOfDate, weekStart } from "./season";
import { expectSupplyHolds, fund, stock } from "./test-support";
import {
  type Command,
  type FirstsCredit,
  SKILLS,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
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

/** A Hearth race the first seat wins in four rounds. The last round's events. */
function race(w: World, seats: string[]) {
  const [first = "", ...rest] = seats;
  const opened = w
    .ok(first, { type: "open_table", game: "hearth_race", pace: "slow", salt: SALT, at: w.tick() })
    .find((e) => e.type === "table_opened");
  const table = opened?.type === "table_opened" ? opened.table : "";
  for (const seat of rest) w.ok(seat, { type: "sit", table, at: w.tick() });
  w.ok(first, { type: "start_game", table, at: w.tick() });
  let events: WorldEvent[] = [];
  for (let round = 1; round <= 4; round++) {
    for (const seat of seats) {
      w.ok(seat, { type: "decide", table, round, move: seat === first ? 3 : 2 });
    }
    events = w.town({ type: "close_round", table, round, at: w.tick() });
  }
  expect(events.some((e) => e.type === "game_over")).toBe(true);
  return events;
}

describe("the curve", () => {
  it("matches its pinned table: level n to n + 1 takes 25 times n", () => {
    const table: [number, number][] = [
      [1, 0],
      [2, 25],
      [3, 75],
      [4, 150],
      [5, 250],
      [7, 525],
      [10, 1_125],
      [15, 2_625],
      [20, 4_750],
      [30, 10_875],
      [50, 30_625],
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
      step: 25,
      harvest: 2,
      craft: 2,
      find: 4,
      fish: 2,
      lesson: 4,
      bounty: 6,
      bountyMinReward: 5,
      game: 2,
      win: 2,
    });
    expect(SKILLS).toEqual(["growing", "making", "foraging", "hosting", "playing"]);
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
    expect(w.state.progress).toEqual({ points: {}, firsts: {} });
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
        total: 4,
        today: 4,
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
    expect(w.points("ada")).toEqual({ playing: 4 });
    expect(w.points("bob")).toEqual({ playing: 2 });
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
    // 12, then 2 each: the eighth harvest makes 26, past level 2's 25.
    expect(events.slice(0, 7).flatMap(reached)).toEqual([]);
    expect(reached(events[7] ?? [])).toEqual([
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
    expect(w.points("ada")).toEqual({ growing: 40, hosting: 4 });
    w.toDay();
    expect(w.state.progress?.today).toBeUndefined();
    w.ok("ada", { type: "harvest", ...(herbs[11] ?? { x: 0, y: 0 }) });
    expect(w.points("ada")).toEqual({ growing: 42, hosting: 4 });
    expect(w.state.progress?.today).toEqual({ ada: { growing: 2 } });
  });

  it("counts a deed only up to what's left of the cap", () => {
    const w = levels();
    // Three counted bounties are 18 points, so a lesson's 4 has room for 2.
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
    expect(w.state.progress).toEqual({ points: {}, firsts: {} });
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
    expect(w.state.progress).toEqual({ points: {}, firsts: {} });
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
    expect(w.state.progress).toEqual({ points: {}, firsts: {} });
  });

  it("coins, gifts, and things bought add nothing", () => {
    const w = levels();
    fund(w.state, "ada", 50);
    stock(w.state, "ada", { lemon: 3 });
    w.toDay();
    w.ok("ada", { type: "give_coins", to: "bob", amount: 5 });
    w.ok("ada", { type: "give", item: "lemon", to: "bob" });
    w.ok("ada", { type: "shop_buy", sku: "lantern" });
    expect(w.state.progress).toEqual({ points: {}, firsts: {} });
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
    expect(w.state.progress).toEqual({ points: {}, firsts: {} });
  });

  it("from a poster who couldn't vote adds nothing", () => {
    const w = levels();
    w.settle("eve");
    // Past her first day, when nobody posts, and two days short of holding her plot long enough.
    w.toDay();
    expect(progress(bounty(w, "eve", "ada"))).toEqual([]);
    expect(w.state.progress).toEqual({ points: {}, firsts: {} });
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
    // 80 points: past level 2's 25 and level 3's 75 at once.
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
      [autumn]: { ada: { growing: 12, hosting: 4 } },
      [winter]: { ada: { growing: 2 } },
    });
    // The total has the credit too; the seasons never do.
    expect(w.points("ada")).toEqual({ growing: 24, hosting: 4 });
  });
});

describe("the levels fixture", () => {
  it("replays a credit, deeds, a bounty week, a rated game, and two seasons to the pinned hash", () => {
    const state = replay(LEVELS_CONFIG, LEVELS_LOG);
    expectSupplyHolds(state);
    expect(state.progress?.points).toEqual({
      eve: { growing: 26, making: 34, foraging: 26, playing: 4 },
      ada: { growing: 10, making: 10 },
      dee: { hosting: 10, playing: 2 },
    });
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
