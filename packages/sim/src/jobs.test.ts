import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { biomeAt } from "./biome";
import { CATALOG, type Crop, GOOD_KINDS, type ItemKind, recipeOf } from "./catalog";
import { JOBS_CONFIG, JOBS_HASH, JOBS_LOG } from "./fixtures/jobs-log";
import { pickupLeft } from "./gather";
import { canonicalJson, fnv1a, hashWorld } from "./hash";
import { HOLIDAYS, holidayOf, holidaySpan } from "./holiday";
import { isFindKind, type StackKind } from "./items";
import { JOB_EDITIONS, JOB_GIVERS, JOBS, type Job, jobById, jobsOn, soloJob } from "./jobs";
import { tileKey } from "./keys";
import { PROGRESS, pointsOf } from "./levels";
import { replay } from "./replay";
import { dateOfDay, SEASONS, seasonOf, seasonSpan, weekStart } from "./season";
import { expectSupplyHolds, stock } from "./test-support";
import type { TimeOfDay } from "./time-of-day";
import {
  type Command,
  SKILLS,
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
};
/** October 4, 2024, a Friday in autumn. */
const DAY = 20_000;
/** The Monday after, when levels and jobs open here. */
const OPEN = DAY + 3;
const TABLE = JOB_EDITIONS[1] ?? [];

/**
 * A world where every input checks the supply identity afterwards (a job never mints, burns, or
 * moves a coin), and every rejection checks that nothing changed at all.
 */
function world() {
  const state = createWorld(CONFIG);
  let today = DAY;
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
  /** Move the world to `day`, or on by one. */
  const toDay = (day = today + 1) => {
    today = day;
    return town({ type: "new_day", day });
  };
  /** Put a resident on a tile, as a walk there would. */
  const standAt = (id: string, x: number, y: number) => {
    const r = state.residents[id];
    if (!r) throw new Error(`${id} isn't here`);
    r.x = x;
    r.y = y;
  };
  return { state, send, ok, code, town, toDay, standAt, day: () => today };
}
type World = ReturnType<typeof world>;

const at = (who: string, dx: number, dy: number) => {
  const [px, py] = PLOTS[who] ?? [0, 0];
  return { x: px * 8 + dx, y: py * 8 + dy };
};

/**
 * Coins, items, the shop, bounties, finds, and recipes open, with Ada, Bob, Cy, and Dee settled
 * before recipes opened, so each knows every recipe, each with a kitchen and a workbench in their
 * hut, a pond beside their hearth, and a fishing rod. Levels open on `OPEN`, a Monday, after all
 * of that, so nobody has a point, and jobs open right after unless `open` is false.
 */
function jobs({ open = true } = {}): World {
  const w = world();
  w.town({ type: "new_day", day: DAY });
  w.town({ type: "open_economy" });
  w.town({ type: "open_items" });
  w.town({ type: "open_shop" });
  w.town({ type: "open_bounties" });
  w.town({ type: "open_finds" });
  const settle = (name: string) => {
    const [px, py] = PLOTS[name] ?? [0, 0];
    w.ok(name, { type: "join", name, kind: "human" });
    w.ok(name, { type: "settle", px, py });
    w.ok(name, { type: "build_starter_home" });
    w.ok(name, { type: "place", ...at(name, 4, 3), block: "workbench" });
    w.ok(name, { type: "place", ...at(name, 4, 2), block: "kitchen" });
    stock(w.state, name, { wood: 3, stone: 2 });
    w.ok(name, { type: "craft", recipe: "fishing_rod", ...at(name, 4, 3) });
    w.ok(name, { type: "place", ...at(name, 3, 2), block: "pond" });
  };
  for (const name of ["ada", "bob", "cy", "dee"]) settle(name);
  w.town({ type: "open_recipes" });
  w.toDay(OPEN);
  w.town({ type: "open_levels", firsts: [] });
  if (open) w.town({ type: "open_jobs" });
  return w;
}

const jobEvents = (events: WorldEvent[]) => events.filter((e) => e.type.startsWith("job_"));
const done = (events: WorldEvent[]) => events.find((e) => e.type === "job_done");
const held = (w: World, who: string) => w.state.jobs?.held?.[who];
const board = (w: World) => jobsOn(w.state).map((job) => job.id);
const job = (id: string): Job => {
  const found = jobById(id);
  if (!found) throw new Error(`no job ${id}`);
  return found;
};

/** Move on a day at a time until `id` is on the board. */
function until(w: World, id: string) {
  for (let tries = 0; tries < 400 && !board(w).includes(id); tries++) w.toDay();
  expect(board(w)).toContain(id);
}

/**
 * `n` planters along the north and south edges of a resident's plot, each holding a ripe `crop`,
 * all within reach of their hearth. Planted today and ripened by hand, as the days would.
 */
function ripe(w: World, who: string, crop: Crop, n: number) {
  stock(w.state, who, { [`${crop}_seed`]: n } as Partial<Record<StackKind, number>>);
  const tiles: { x: number; y: number }[] = [];
  for (let i = 0; tiles.length < n; i++) {
    const tile = at(who, i % 7, i < 7 ? 0 : 6);
    const key = tileKey(tile.x, tile.y);
    if (w.state.items?.crops[key]) continue;
    if (w.state.blocks[key] !== "planter") w.ok(who, { type: "place", ...tile, block: "planter" });
    w.ok(who, { type: "plant", ...tile, seed: crop });
    const planting = w.state.items?.crops[key];
    if (planting) planting.readyDay = w.day();
    tiles.push(tile);
  }
  return tiles;
}

const harvest = (w: World, who: string, tile: { x: number; y: number }) =>
  w.ok(who, { type: "harvest", ...tile });

/** A cast that brings up a minnow whatever the season, the sky, or the hour (roll 0 is a boot). */
const cast = (w: World, who: string, timeOfDay: TimeOfDay = "day", roll = 600) =>
  w.ok(who, { type: "fish", roll, weather: "clear", timeOfDay });

/** Make one of `kind` at the station it needs, with what it takes put in the maker's things. */
function make(w: World, who: string, kind: ItemKind) {
  const recipe = CATALOG[kind].recipe;
  if (!recipe) throw new Error(`${kind} has no recipe`);
  stock(w.state, who, recipe.needs as Partial<Record<StackKind, number>>);
  const station = recipe.station === "kitchen" ? at(who, 4, 2) : at(who, 4, 3);
  return w.ok(who, { type: "craft", recipe: kind, ...station } as Command);
}

/** The first kind a recipe makes: `jam` makes lemon jam. */
const kindOf = (recipe: string) =>
  (Object.keys(CATALOG) as ItemKind[]).find(
    (kind) => CATALOG[kind].recipe && recipeOf(kind as never) === recipe,
  ) as ItemKind;

/**
 * Do what a held job asks, for the jobs one resident can do alone: harvests, crafts, casts, and a
 * made thing handed in. The events of the input that finished it.
 */
function finish(w: World, who: string, id: string): WorldEvent[] {
  const { deed, bring } = job(id);
  if (bring !== undefined) {
    make(w, who, kindOf(bring));
    return w.ok(who, { type: "hand_in" });
  }
  let events: WorldEvent[] = [];
  if (deed?.type === "harvest") {
    for (const tile of ripe(w, who, deed.crops?.[0] ?? "herb", deed.count)) {
      events = harvest(w, who, tile);
    }
  } else if (deed?.type === "craft") {
    for (let i = 0; i < deed.count; i++) events = make(w, who, kindOf(deed.recipe));
  } else if (deed?.type === "fish") {
    for (let i = 0; i < deed.count; i++) events = cast(w, who, deed.timeOfDay);
  } else throw new Error(`${id} isn't a job one resident does alone here`);
  return events;
}

/** One of today's jobs that `finish` can do: the one for home, a harvest or something to make. */
const doable = (w: World) => jobsOn(w.state)[0]?.id ?? "";

/** Take one of today's jobs that `finish` can do, and do it. Its `job_done`. */
function takeAndFinish(w: World, who: string) {
  const id = doable(w);
  w.ok(who, { type: "take_job", job: id });
  const event = done(finish(w, who, id));
  expect(event, `${who} ${id}`).toBeDefined();
  return event;
}

/** The world's jobs open, on `day`, to ask it for that day's board. */
const opened = jobs().state;
const boardOn = (day: number) => jobsOn({ ...opened, day });
/** Two years from the day jobs open here. */
const DAYS = Array.from({ length: 731 }, (_, i) => OPEN + i);

describe("the numbers", () => {
  it("are pinned, so a change is deliberate and comes with a run of scripts/economy-sim.ts", () => {
    expect(JOBS).toEqual({
      board: 3,
      held: 1,
      perDay: 1,
      perWeek: 3,
      keepDays: 7,
      points: 10,
    });
  });

  it("pin the first edition's table, which a live world's logged take_job reads", () => {
    expect(TABLE.map((j) => j.id)).toEqual([
      "juniper_crops",
      "juniper_herbs",
      "juniper_flowers",
      "juniper_pumpkins",
      "juniper_cranberries",
      "clem_herb_tea",
      "clem_jam",
      "clem_pumpkin_pie",
      "clem_cranberry_punch",
      "clem_candy",
      "clem_candy_canes",
      "bram_chair",
      "bram_table",
      "bram_stone_wall",
      "bram_barrel",
      "bram_jack_o_lantern",
      "ansel_bouquet",
      "ansel_flower_box",
      "marlo_find",
      "marlo_sand_find",
      "marlo_forest_find",
      "marlo_autumn_find",
      "sable_dusk_fish",
      "sable_night_fish",
      "sable_three_fish",
      "otis_teach",
      "otis_guest",
      "otis_host",
      "otis_bounty",
      "pip_game",
      "pip_two_games",
      "pip_win",
    ]);
    // Every word of it: what each job asks, its skill, and when it's up.
    expect(fnv1a(canonicalJson(TABLE))).toBe("598485db");
  });

  it("give every job one giver, one skill, and one thing to do, from a made thing or a deed", () => {
    expect(new Set(TABLE.map((j) => j.id)).size).toBe(TABLE.length);
    for (const j of TABLE) {
      expect(JOB_GIVERS, j.id).toContain(j.giver);
      expect(j.id.startsWith(`${j.giver}_`), j.id).toBe(true);
      expect(SKILLS, j.id).toContain(j.skill);
      expect((j.deed === undefined) !== (j.bring === undefined), j.id).toBe(true);
      expect(j.season === undefined || j.holiday === undefined, j.id).toBe(true);
      if (j.deed) expect([1, 2, 3], j.id).toContain(j.deed.count);
      // A bring job asks for a made thing, which carries its maker. Nothing that stacks.
      if (j.bring !== undefined) {
        const makes = GOOD_KINDS.filter((kind) => recipeOf(kind) === j.bring);
        expect(makes.length, j.id).toBeGreaterThan(0);
        expect(j.skill, j.id).toBe("making");
      }
    }
    // Every giver asks for something, and every skill has jobs.
    expect(new Set(TABLE.map((j) => j.giver)).size).toBe(JOB_GIVERS.length);
    expect(new Set(TABLE.map((j) => j.skill)).size).toBe(SKILLS.length);
  });
});

describe("the board", () => {
  it("is empty until jobs open", () => {
    const w = jobs({ open: false });
    expect(jobsOn(w.state)).toEqual([]);
    expect(w.code("ada", { type: "take_job", job: "bram_chair" })).toBe("unknown_job");
  });

  it("is the same for a day however it's asked", () => {
    const w = jobs();
    const today = board(w);
    expect(today).toHaveLength(JOBS.board);
    expect(board(w)).toEqual(today);
    // A snapshot of the world, and another world on the same day where other things happened.
    expect(jobsOn(JSON.parse(JSON.stringify(w.state)) as WorldState).map((j) => j.id)).toEqual(
      today,
    );
    const other = jobs();
    other.ok("bob", { type: "take_job", job: today[0] ?? "" });
    other.ok("ada", { type: "move", dir: "s" });
    expect(board(other)).toEqual(today);
    // And it's a day's: nothing anyone does moves it, and midnight does.
    w.ok("ada", { type: "take_job", job: today[1] ?? "" });
    expect(board(w)).toEqual(today);
    w.toDay();
    expect(board(w)).not.toEqual(today);
  });

  it("has one job for home, one for a walk, and one with neighbors, each day of two years", () => {
    const wrong: string[] = [];
    for (const day of DAYS) {
      const [home, walk, neighbors, ...more] = boardOn(day);
      const fine =
        more.length === 0 &&
        (home?.skill === "growing" || home?.skill === "making") &&
        walk?.skill === "foraging" &&
        (neighbors?.skill === "hosting" || neighbors?.skill === "playing");
      if (!fine) wrong.push(`${day}: ${[home, walk, neighbors].map((j) => j?.id).join(", ")}`);
    }
    expect(wrong).toEqual([]);
  });

  it("never has the same job two days running", () => {
    const repeats: string[] = [];
    let before: string[] = [];
    for (const day of DAYS) {
      const today = boardOn(day).map((j) => j.id);
      for (const id of today) if (before.includes(id)) repeats.push(`${day}: ${id}`);
      before = today;
    }
    expect(repeats).toEqual([]);
  });

  it("always has a job a resident can do alone, with no recipe to learn and no rod", () => {
    const without = DAYS.filter((day) => !boardOn(day).some(soloJob));
    expect(without).toEqual([]);
    // What that means: a harvest, a find, or something everyone knows how to make.
    expect(TABLE.filter(soloJob).map((j) => j.id)).toEqual([
      "juniper_crops",
      "juniper_herbs",
      "juniper_flowers",
      "juniper_pumpkins",
      "juniper_cranberries",
      "clem_herb_tea",
      "clem_jam",
      "clem_candy",
      "clem_candy_canes",
      "bram_chair",
      "bram_table",
      "bram_stone_wall",
      "bram_jack_o_lantern",
      "ansel_bouquet",
      "marlo_find",
      "marlo_sand_find",
      "marlo_forest_find",
      "marlo_autumn_find",
    ]);
  });

  it("has every skill at least three days in every seven", () => {
    const thin: string[] = [];
    for (let i = 0; i + 7 <= DAYS.length; i++) {
      const week = DAYS.slice(i, i + 7).map((day) => boardOn(day).map((j) => j.skill));
      for (const skill of SKILLS) {
        if (week.filter((skills) => skills.includes(skill)).length < 3) {
          thin.push(`${DAYS[i]}: ${skill}`);
        }
      }
    }
    expect(thin).toEqual([]);
  });

  it("has a season's jobs only in their season, and each one comes up in it", () => {
    const wrong: string[] = [];
    const seen = new Map<number, Set<string>>();
    for (const day of DAYS) {
      const { start } = seasonSpan(day);
      for (const j of boardOn(day)) {
        if (j.season !== undefined && j.season !== seasonOf(day)) wrong.push(`${day}: ${j.id}`);
        seen.set(start, (seen.get(start) ?? new Set()).add(j.id));
      }
    }
    expect(wrong).toEqual([]);
    // Each whole season in the two years: every job with no holiday that's up in it came up.
    const missing: string[] = [];
    for (const [start, ids] of seen) {
      const { season, end } = seasonSpan(start);
      if (start < OPEN || end > OPEN + DAYS.length) continue;
      for (const j of TABLE) {
        if (j.holiday !== undefined || (j.season !== undefined && j.season !== season)) continue;
        if (!ids.has(j.id)) missing.push(`${season} from ${start}: ${j.id}`);
      }
    }
    expect(missing).toEqual([]);
    expect(SEASONS.filter((s) => TABLE.some((j) => j.season === s))).toEqual(["autumn", "winter"]);
  });

  it("has a holiday's jobs only while it runs, and each one comes up every time it does", () => {
    const wrong: string[] = [];
    for (const day of DAYS) {
      for (const j of boardOn(day)) {
        if (j.holiday !== undefined && j.holiday !== holidayOf(day)) wrong.push(`${day}: ${j.id}`);
      }
    }
    expect(wrong).toEqual([]);
    const missing: string[] = [];
    for (const holiday of HOLIDAYS) {
      for (const year of [2024, 2025]) {
        const { first, last } = holidaySpan(holiday, year);
        const up = new Set<string>();
        for (let day = first; day <= last; day++) for (const j of boardOn(day)) up.add(j.id);
        for (const j of TABLE) {
          if (j.holiday === holiday && !up.has(j.id)) missing.push(`${holiday} ${year}: ${j.id}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("has every job in season in the month the economy run plays, autumn and winter", () => {
    for (const start of [DAY, DAY + 61]) {
      const up = new Set<string>();
      for (let day = start; day < start + 30; day++) for (const j of boardOn(day)) up.add(j.id);
      const season = seasonOf(start);
      const due = TABLE.filter(
        (j) =>
          (j.season === undefined || j.season === season) &&
          (j.holiday === undefined ||
            Array.from({ length: 30 }, (_, i) => holidayOf(start + i)).includes(j.holiday)),
      );
      expect(
        due.filter((j) => !up.has(j.id)).map((j) => j.id),
        JSON.stringify(dateOfDay(start)),
      ).toEqual([]);
    }
  });

  it("leaves out what the world hasn't opened, and gives that slot's other lane every day", () => {
    // Items, levels, and jobs, with no finds, no lessons, and no bounties.
    const w = world();
    w.town({ type: "new_day", day: DAY });
    w.town({ type: "open_items" });
    w.town({ type: "open_levels", firsts: [] });
    w.town({ type: "open_jobs" });
    let before: string[] = [];
    for (let day = DAY; day < DAY + 60; day++) {
      const today = jobsOn({ ...w.state, day });
      expect(today.map((j) => j.deed?.type)).not.toContain("find");
      expect(today.map((j) => j.deed?.type)).not.toContain("teach");
      expect(today.map((j) => j.deed?.type)).not.toContain("bounty");
      // The walk is a fish every day, and still never the same job two days running.
      expect(today[1]?.deed?.type, String(day)).toBe("fish");
      const ids = today.map((j) => j.id);
      expect(ids.filter((id) => before.includes(id))).toEqual([]);
      before = ids;
    }
  });
});

describe("open_jobs", () => {
  it("only comes from the server, once, after levels", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    w.town({ type: "open_items" });
    expect(w.code(TOWN_ACTOR, { type: "open_jobs" })).toBe("not_due");
    w.town({ type: "open_levels", firsts: [] });
    w.ok("ada", { type: "join", name: "ada", kind: "human" });
    expect(w.code("ada", { type: "open_jobs" })).toBe("server_only");
    expect(w.town({ type: "open_jobs" })).toEqual([{ type: "jobs_opened" }]);
    // Nothing is stored until someone takes a job.
    expect(w.state.jobs).toEqual({ opened: DAY, edition: 1 });
    expect(w.code(TOWN_ACTOR, { type: "open_jobs" })).toBe("already_open");
  });

  it("changes nothing a deed does until it's logged", () => {
    const w = jobs({ open: false });
    const events = [
      ...ripe(w, "ada", "herb", 3).flatMap((tile) => harvest(w, "ada", tile)),
      ...make(w, "ada", "chair"),
      ...cast(w, "ada", "night"),
    ];
    expect(jobEvents(events)).toEqual([]);
    expect(w.state.jobs).toBeUndefined();
    expect(w.code("ada", { type: "drop_job" })).toBe("no_job");
    expect(w.code("ada", { type: "hand_in" })).toBe("no_job");
  });
});

describe("take_job", () => {
  it("holds one of today's jobs, from anywhere, and says so to its resident", () => {
    const w = jobs();
    const [first = ""] = board(w);
    w.standAt("ada", 12, 12);
    expect(w.ok("ada", { type: "take_job", job: first })).toEqual([
      { type: "job_taken", residentId: "ada", job: first },
    ]);
    expect(w.state.jobs).toEqual({
      opened: OPEN,
      edition: 1,
      held: { ada: { job: first, day: OPEN } },
    });
  });

  it("refuses a job that isn't on today's board", () => {
    const w = jobs();
    const today = board(w);
    const off = TABLE.find((j) => !today.includes(j.id))?.id ?? "";
    expect(w.code("ada", { type: "take_job", job: off })).toBe("unknown_job");
    expect(w.code("ada", { type: "take_job", job: "no_such_job" })).toBe("unknown_job");
    expect(w.code("ada", { type: "take_job", job: 7 } as unknown as Command)).toBe("unknown_job");
    // Yesterday's job is off the board too.
    w.toDay();
    expect(board(w)).not.toContain(today[0]);
    expect(w.code("ada", { type: "take_job", job: today[0] ?? "" })).toBe("unknown_job");
  });

  it("takes a hearth, and townsfolk never take one", () => {
    const w = jobs();
    const [first = ""] = board(w);
    w.ok("eve", { type: "join", name: "eve", kind: "agent" });
    expect(w.code("eve", { type: "take_job", job: first })).toBe("no_hearth");
    w.town({ type: "set_townsfolk", ids: ["dee"] });
    expect(w.code("dee", { type: "take_job", job: first })).toBe("not_eligible");
    expect(w.state.jobs?.held).toBeUndefined();
  });

  it("is refused while a job is held, until it's let go", () => {
    const w = jobs();
    const [first = "", second = ""] = board(w);
    w.ok("ada", { type: "take_job", job: first });
    expect(w.code("ada", { type: "take_job", job: second })).toBe("job_held");
    expect(w.code("ada", { type: "take_job", job: first })).toBe("job_held");
    // Someone else holding it is no reason: the board is everyone's.
    w.ok("bob", { type: "take_job", job: first });
    expect(w.ok("ada", { type: "drop_job" })).toEqual([
      { type: "job_dropped", residentId: "ada", job: first },
    ]);
    expect(held(w, "ada")).toBeUndefined();
    expect(w.code("ada", { type: "drop_job" })).toBe("no_job");
    // Taking and letting go costs nothing, so the next take is free.
    w.ok("ada", { type: "take_job", job: second });
    expect(held(w, "ada")).toEqual({ job: second, day: OPEN });
  });

  it("is refused for the rest of the day once one job is finished", () => {
    const w = jobs();
    expect(takeAndFinish(w, "ada")).toMatchObject({ residentId: "ada", week: 1 });
    expect(w.state.jobs?.doneToday).toEqual(["ada"]);
    for (const id of board(w))
      expect(w.code("ada", { type: "take_job", job: id })).toBe("job_limit");
    // Bob's day is his own.
    expect(takeAndFinish(w, "bob")).toMatchObject({ residentId: "bob", week: 1 });
    w.toDay();
    expect(w.state.jobs?.doneToday).toBeUndefined();
    expect(takeAndFinish(w, "ada")).toMatchObject({ week: 2 });
  });

  it("is refused for the rest of the UTC week once three are finished", () => {
    const w = jobs();
    // Monday, Tuesday, Wednesday.
    for (const week of [1, 2, 3]) {
      expect(takeAndFinish(w, "ada")).toMatchObject({ week });
      w.toDay();
    }
    expect(w.state.jobs?.week).toEqual({ start: OPEN, done: { ada: 3 } });
    // Thursday to Sunday: nothing more counts, however often it's asked.
    for (let day = OPEN + 3; day <= OPEN + 6; day++) {
      expect(weekStart(day)).toBe(OPEN);
      for (const id of board(w)) {
        expect(w.code("ada", { type: "take_job", job: id }), `${day} ${id}`).toBe("job_limit");
      }
      // Bob, who played one day this week, has all three left.
      if (day === OPEN + 5) expect(takeAndFinish(w, "bob")).toMatchObject({ week: 1 });
      w.toDay();
    }
    // Monday: a new week.
    expect(w.day()).toBe(OPEN + 7);
    expect(takeAndFinish(w, "ada")).toMatchObject({ week: 1 });
    expect(w.state.jobs?.week).toEqual({ start: OPEN + 7, done: { ada: 1 } });
  });

  it("counts a job in the week it's finished in, so one held over Sunday is Monday's first", () => {
    const w = jobs();
    // Friday and Saturday: two this week.
    w.toDay(OPEN + 4);
    takeAndFinish(w, "ada");
    w.toDay(OPEN + 5);
    takeAndFinish(w, "ada");
    // Sunday: a third is taken, and not done until Monday.
    w.toDay(OPEN + 6);
    const sundays = doable(w);
    w.ok("ada", { type: "take_job", job: sundays });
    w.toDay(OPEN + 7);
    expect(done(finish(w, "ada", sundays))).toMatchObject({ job: sundays, week: 1 });
    expect(w.state.jobs?.week).toEqual({ start: OPEN + 7, done: { ada: 1 } });
    // So this week has two more, and no fourth.
    for (const week of [2, 3]) {
      w.toDay();
      expect(takeAndFinish(w, "ada")).toMatchObject({ week });
    }
    w.toDay();
    expect(w.code("ada", { type: "take_job", job: doable(w) })).toBe("job_limit");
  });
});

describe("a deed job", () => {
  it("counts each deed that fits, in the deed's own answer, and is done at its count", () => {
    const w = jobs();
    until(w, "juniper_herbs");
    w.ok("ada", { type: "take_job", job: "juniper_herbs" });
    const [first, second, third] = ripe(w, "ada", "herb", 3).map((tile) =>
      jobEvents(harvest(w, "ada", tile)),
    );
    expect(first).toEqual([
      { type: "job_progress", residentId: "ada", job: "juniper_herbs", count: 1, of: 3 },
    ]);
    expect(second).toEqual([
      { type: "job_progress", residentId: "ada", job: "juniper_herbs", count: 2, of: 3 },
    ]);
    expect(third).toEqual([
      {
        type: "job_done",
        residentId: "ada",
        job: "juniper_herbs",
        skill: "growing",
        points: JOBS.points,
        week: 1,
      },
    ]);
    expect(held(w, "ada")).toBeUndefined();
    expect(w.state.jobs?.held).toBeUndefined();
  });

  it("adds 10 points to its skill once, outside the daily cap, and in the season's points", () => {
    const w = jobs();
    until(w, "juniper_herbs");
    w.ok("ada", { type: "take_job", job: "juniper_herbs" });
    const tiles = ripe(w, "ada", "herb", 4);
    const events = tiles.slice(0, 3).flatMap((tile) => harvest(w, "ada", tile));
    // Three harvests at 2, herbs' first at 10, and the job's 10.
    const growing = 3 * PROGRESS.harvest + PROGRESS.first + JOBS.points;
    expect(pointsOf(w.state, "ada")).toEqual({ growing });
    // The job's points come in a `progress` of their own, after `job_done`, and count toward no
    // cap. A level they reach is said as any level is.
    expect(events.slice(-4)).toEqual([
      {
        type: "job_done",
        residentId: "ada",
        job: "juniper_herbs",
        skill: "growing",
        points: 10,
        week: 1,
      },
      {
        type: "progress",
        residentId: "ada",
        skill: "growing",
        points: 10,
        total: growing,
        today: 6,
      },
      { type: "level_reached", residentId: "ada", skill: "growing", level: 2 },
      { type: "level_reached", residentId: "ada", level: 2 },
    ]);
    expect(w.state.progress?.today).toEqual({ ada: { growing: 6 } });
    const season = String(seasonSpan(w.day()).start);
    expect(w.state.progress?.seasons?.[season]).toEqual({ ada: { growing } });
    // A fourth harvest is a harvest, and no job's.
    expect(jobEvents(harvest(w, "ada", tiles[3] ?? { x: 0, y: 0 }))).toEqual([]);
    expect(pointsOf(w.state, "ada")).toEqual({ growing: growing + PROGRESS.harvest });
  });

  it("still moves past the skill's daily cap, where the deed itself earns nothing", () => {
    const w = jobs();
    until(w, "juniper_crops");
    // Ten harvests reach Growing's cap of 20.
    for (const tile of ripe(w, "ada", "herb", PROGRESS.dailyCap / PROGRESS.harvest)) {
      harvest(w, "ada", tile);
    }
    const capped = PROGRESS.dailyCap + PROGRESS.first;
    expect(pointsOf(w.state, "ada")).toEqual({ growing: capped });
    w.ok("ada", { type: "take_job", job: "juniper_crops" });
    const events = ripe(w, "ada", "herb", 3).map((tile) => harvest(w, "ada", tile));
    expect(events.map((e) => e.filter((x) => x.type === "progress").length)).toEqual([0, 0, 1]);
    expect(done(events[2] ?? [])).toMatchObject({ job: "juniper_crops", points: 10 });
    expect(pointsOf(w.state, "ada")).toEqual({ growing: capped + JOBS.points });
    expect(w.state.progress?.today).toEqual({ ada: { growing: PROGRESS.dailyCap } });
  });

  it("moves only for deeds done after it was taken", () => {
    const w = jobs();
    until(w, "juniper_herbs");
    const tiles = ripe(w, "ada", "herb", 4);
    // Two harvests before the job is taken count for nothing toward it.
    for (const tile of tiles.slice(0, 2)) expect(jobEvents(harvest(w, "ada", tile))).toEqual([]);
    expect(w.state.jobs).toEqual({ opened: OPEN, edition: 1 });
    w.ok("ada", { type: "take_job", job: "juniper_herbs" });
    expect(held(w, "ada")).toEqual({ job: "juniper_herbs", day: w.day() });
    for (const tile of tiles.slice(2)) harvest(w, "ada", tile);
    expect(held(w, "ada")).toEqual({ job: "juniper_herbs", day: w.day(), count: 2 });
  });

  it("moves only the job its own resident holds, and only for the deed it asks for", () => {
    const w = jobs();
    until(w, "juniper_flowers");
    w.ok("ada", { type: "take_job", job: "juniper_flowers" });
    w.ok("bob", { type: "take_job", job: "juniper_flowers" });
    // Bob's flower is Bob's.
    const [bobs] = ripe(w, "bob", "flower", 1);
    harvest(w, "bob", bobs ?? { x: 0, y: 0 });
    expect(held(w, "bob")?.count).toBe(1);
    expect(held(w, "ada")?.count).toBeUndefined();
    // A herb isn't a flower, and a chair and a fish aren't harvests.
    const [herb] = ripe(w, "ada", "herb", 1);
    const others = [
      ...harvest(w, "ada", herb ?? { x: 0, y: 0 }),
      ...make(w, "ada", "chair"),
      ...cast(w, "ada"),
    ];
    expect(jobEvents(others)).toEqual([]);
    expect(held(w, "ada")?.count).toBeUndefined();
    const [flower] = ripe(w, "ada", "flower", 1);
    harvest(w, "ada", flower ?? { x: 0, y: 0 });
    expect(held(w, "ada")?.count).toBe(1);
  });

  it("keeps its meaning after the board moves on", () => {
    const w = jobs();
    until(w, "juniper_herbs");
    w.ok("ada", { type: "take_job", job: "juniper_herbs" });
    w.toDay(w.day() + 3);
    expect(board(w)).not.toContain("juniper_herbs");
    const events = ripe(w, "ada", "herb", 3).flatMap((tile) => harvest(w, "ada", tile));
    expect(done(events)).toMatchObject({ job: "juniper_herbs" });
  });

  it("counts a craft of its recipe, and no other", () => {
    const w = jobs();
    until(w, "bram_chair");
    w.ok("ada", { type: "take_job", job: "bram_chair" });
    expect(jobEvents(make(w, "ada", "table"))).toEqual([]);
    expect(done(make(w, "ada", "chair"))).toMatchObject({ job: "bram_chair", skill: "making" });
  });

  it("counts a fish caught at night for the night job, and not one caught at noon, nor a boot", () => {
    const w = jobs();
    until(w, "sable_night_fish");
    w.ok("ada", { type: "take_job", job: "sable_night_fish" });
    expect(jobEvents(cast(w, "ada", "day"))).toEqual([]);
    expect(jobEvents(cast(w, "ada", "dusk"))).toEqual([]);
    // A boot at night is no fish.
    expect(jobEvents(cast(w, "ada", "night", 0))).toEqual([]);
    expect(held(w, "ada")).toEqual({ job: "sable_night_fish", day: w.day() });
    expect(done(cast(w, "ada", "night"))).toMatchObject({
      job: "sable_night_fish",
      skill: "foraging",
    });
  });

  it("counts three fish at any hour for the three-fish job", () => {
    const w = jobs();
    until(w, "sable_three_fish");
    w.ok("ada", { type: "take_job", job: "sable_three_fish" });
    expect(jobEvents(cast(w, "ada", "dawn"))).toMatchObject([{ count: 1, of: 3 }]);
    expect(jobEvents(cast(w, "ada", "day", 0))).toEqual([]);
    expect(jobEvents(cast(w, "ada", "night"))).toMatchObject([{ count: 2, of: 3 }]);
    expect(done(cast(w, "ada", "dusk"))).toMatchObject({ job: "sable_three_fish" });
  });

  it("counts a find, and where the job says, and a fallen branch or a loose stone never", () => {
    const w = jobs();
    /**
     * With `id` held, a tile where a pickup like that lies today, looking on to the next days the
     * job is up until one does. A held job lasts a week, so it's taken afresh each day.
     */
    const lying = (id: string, wanted: (kind: string, x: number, y: number) => boolean) => {
      for (let tries = 0; tries < 400; tries++) {
        if (held(w, "ada")) w.ok("ada", { type: "drop_job" });
        until(w, id);
        w.ok("ada", { type: "take_job", job: id });
        for (let y = 0; y < CONFIG.height; y++) {
          for (let x = 0; x < CONFIG.width; x++) {
            const kind = pickupLeft(w.state, x, y);
            if (kind && wanted(kind, x, y)) return { x, y };
          }
        }
        w.toDay();
      }
      throw new Error("nothing like that lay anywhere");
    };
    const gather = (tile: { x: number; y: number }) => {
      w.standAt("ada", tile.x, tile.y);
      return jobEvents(w.ok("ada", { type: "gather", ...tile }));
    };
    const sand = (x: number, y: number) => biomeAt(CONFIG, x, y) === "sand";
    const rubble = (kind: string) => kind === "wood" || kind === "stone";
    // Any find will do for Marlo's first job, and wood and stone are no finds.
    expect(gather(lying("marlo_find", rubble))).toEqual([]);
    expect(gather(lying("marlo_find", isFindKind))).toMatchObject([
      { type: "job_done", job: "marlo_find", skill: "foraging" },
    ]);
    // His sand job wants one that lay on sand.
    w.toDay(w.day() + 7);
    const inland = lying("marlo_sand_find", (kind, x, y) => isFindKind(kind) && !sand(x, y));
    expect(gather(inland)).toEqual([]);
    const shore = lying("marlo_sand_find", (kind, x, y) => isFindKind(kind) && sand(x, y));
    expect(gather(shore)).toMatchObject([{ type: "job_done", job: "marlo_sand_find" }]);
  });
});

describe("hand_in", () => {
  it("finishes a bring job with a thing its resident made, which leaves the world", () => {
    const w = jobs();
    until(w, "clem_herb_tea");
    w.ok("ada", { type: "take_job", job: "clem_herb_tea" });
    expect(w.code("ada", { type: "hand_in" })).toBe("nothing_to_hand_in");
    const made = make(w, "ada", "herb_tea").find((e) => e.type === "inventory");
    const id = made?.type === "inventory" ? (made.gained?.[0]?.id ?? "") : "";
    // Making it isn't handing it in.
    expect(held(w, "ada")).toEqual({ job: "clem_herb_tea", day: w.day() });
    const before = pointsOf(w.state, "ada").making ?? 0;
    expect(w.ok("ada", { type: "hand_in" }).slice(0, 3)).toEqual([
      { type: "inventory", residentId: "ada", reason: "handed_in", lost: [id] },
      {
        type: "job_done",
        residentId: "ada",
        job: "clem_herb_tea",
        skill: "making",
        points: 10,
        week: 1,
      },
      {
        type: "progress",
        residentId: "ada",
        skill: "making",
        points: 10,
        total: before + 10,
        today: 2,
      },
    ]);
    expect(w.state.items?.inventories.ada?.goods.map((g) => g.id)).not.toContain(id);
    expect(JSON.stringify(w.state.items)).not.toContain(`"${id}"`);
    expect(w.code("ada", { type: "hand_in" })).toBe("no_job");
  });

  it("refuses a thing someone else made, so a jar passed around finishes only its maker's job", () => {
    const w = jobs();
    until(w, "clem_jam");
    w.ok("ada", { type: "take_job", job: "clem_jam" });
    w.ok("bob", { type: "take_job", job: "clem_jam" });
    const made = make(w, "ada", "lemon_jam").find((e) => e.type === "inventory");
    const adas = made?.type === "inventory" ? (made.gained?.[0]?.id ?? "") : "";
    w.ok("ada", { type: "give", item: adas, to: "bob" });
    // Bob holds Ada's jar: not his to hand in, by name or not.
    expect(w.code("bob", { type: "hand_in" })).toBe("nothing_to_hand_in");
    expect(w.code("bob", { type: "hand_in", item: adas })).toBe("nothing_to_hand_in");
    expect(held(w, "bob")).toEqual({ job: "clem_jam", day: w.day() });
    // Any fruit's jam is jam. With one of his own beside it, his is the one that goes.
    const own = make(w, "bob", "strawberry_jam").find((e) => e.type === "inventory");
    const bobs = own?.type === "inventory" ? (own.gained?.[0]?.id ?? "") : "";
    expect(w.ok("bob", { type: "hand_in" }).slice(0, 3)).toMatchObject([
      { type: "inventory", lost: [bobs] },
      { type: "job_done", residentId: "bob", job: "clem_jam" },
      { type: "progress", residentId: "bob" },
    ]);
    expect(w.state.items?.inventories.bob?.goods.map((g) => g.id)).toEqual(
      expect.arrayContaining([adas]),
    );
    // Back with its maker, the jar finishes hers.
    w.ok("bob", { type: "give", item: adas, to: "ada" });
    expect(done(w.ok("ada", { type: "hand_in", item: adas }))).toMatchObject({ residentId: "ada" });
  });

  it("takes the oldest thing of the kind, or the one named, and nothing of another kind", () => {
    const w = jobs();
    until(w, "clem_herb_tea");
    const ids = ["herb_tea", "lemon_jam", "herb_tea"].map((kind) => {
      const made = make(w, "ada", kind as ItemKind).find((e) => e.type === "inventory");
      return made?.type === "inventory" ? (made.gained?.[0]?.id ?? "") : "";
    });
    const [older = "", jam = "", newer = ""] = ids;
    w.ok("ada", { type: "take_job", job: "clem_herb_tea" });
    expect(w.code("ada", { type: "hand_in", item: jam })).toBe("nothing_to_hand_in");
    expect(w.code("ada", { type: "hand_in", item: "i_999" })).toBe("nothing_to_hand_in");
    expect(w.code("ada", { type: "hand_in", item: "herb_tea" })).toBe("nothing_to_hand_in");
    expect(w.ok("ada", { type: "hand_in" })[0]).toMatchObject({ lost: [older] });
    // The next day, the newer one by name.
    w.toDay(w.day() + 1);
    until(w, "clem_herb_tea");
    w.ok("ada", { type: "take_job", job: "clem_herb_tea" });
    expect(w.ok("ada", { type: "hand_in", item: newer })[0]).toMatchObject({ lost: [newer] });
    expect(w.state.items?.inventories.ada?.goods.map((g) => g.id)).toContain(jam);
  });

  it("is refused for a deed job, which is done by doing it", () => {
    const w = jobs();
    until(w, "bram_chair");
    w.ok("ada", { type: "take_job", job: "bram_chair" });
    make(w, "bob", "herb_tea");
    expect(w.code("ada", { type: "hand_in" })).toBe("no_job");
    expect(w.code("bob", { type: "hand_in" })).toBe("no_job");
  });
});

describe("a held job", () => {
  it("lasts seven days and lapses on the eighth, with nothing lost", () => {
    const w = jobs();
    const [first = ""] = board(w);
    w.ok("ada", { type: "take_job", job: first });
    for (let day = OPEN + 1; day < OPEN + JOBS.keepDays; day++) {
      expect(jobEvents(w.toDay(day))).toEqual([]);
      expect(held(w, "ada")).toEqual({ job: first, day: OPEN });
    }
    // Bob takes one on the seventh day, which stays when Ada's goes.
    const [bobs = ""] = board(w);
    w.ok("bob", { type: "take_job", job: bobs });
    expect(jobEvents(w.toDay(OPEN + JOBS.keepDays))).toEqual([
      { type: "job_dropped", residentId: "ada", job: first, lapsed: true },
    ]);
    expect(w.state.jobs?.held).toEqual({ bob: { job: bobs, day: OPEN + 6 } });
    // Nothing is lost: no points, no count against the week, and the next take is free.
    expect(pointsOf(w.state, "ada")).toEqual({});
    expect(w.state.jobs?.week).toBeUndefined();
    expect(takeAndFinish(w, "ada")).toMatchObject({ week: 1 });
  });

  it("lapses when the world skips past its eighth day, everyone's in id order", () => {
    const w = jobs();
    const [first = ""] = board(w);
    for (const who of ["dee", "ada", "cy"]) w.ok(who, { type: "take_job", job: first });
    expect(jobEvents(w.toDay(OPEN + 30)).map((e) => "residentId" in e && e.residentId)).toEqual([
      "ada",
      "cy",
      "dee",
    ]);
    expect(w.state.jobs).toEqual({ opened: OPEN, edition: 1 });
  });
});

describe("the jobs fixture", () => {
  it("replays a week of jobs taken, dropped, done, handed in, and lapsed to the pinned hash", () => {
    const state = replay(JOBS_CONFIG, JOBS_LOG);
    expectSupplyHolds(state);
    expect(state.jobs).toEqual({
      opened: 20_059,
      edition: 1,
      // Bob still holds Clem's job, with only Ada's jar to his name.
      held: { bob: { job: "clem_herb_tea", day: 20_071 } },
      doneToday: ["eve"],
      // The second week: Sable's night fish and Clem's tea. The first week's three are gone.
      week: { start: 20_066, done: { eve: 2 } },
    });
    // Five jobs at 10 points on top of her deeds: two for Sable and one for Marlo, Juniper, and Clem.
    expect(state.progress?.points.eve).toEqual({
      growing: 42,
      making: 44,
      foraging: 80,
      hosting: 2,
      playing: 8,
    });
    expect(hashWorld(state)).toBe(JOBS_HASH);
  });
});
