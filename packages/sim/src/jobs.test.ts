import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { biomeAt } from "./biome";
import { CATALOG, type Crop, GOOD_KINDS, type ItemKind, recipeOf } from "./catalog";
import { JOBS_CONFIG, JOBS_HASH, JOBS_LOG } from "./fixtures/jobs-log";
import { MERGE_CONFIG, MERGE_LOG } from "./fixtures/merge-log";
import { REPEAT_JOINS_CONFIG, REPEAT_JOINS_LOG } from "./fixtures/repeat-joins-log";
import { pickupLeft } from "./gather";
import { canonicalJson, fnv1a, hashWorld } from "./hash";
import { HOLIDAYS, holidayOf, holidaySpan } from "./holiday";
import { isFindKind, type StackKind } from "./items";
import {
  JOB_EDITIONS,
  JOB_GIVERS,
  JOB_TITLE_INFO,
  JOBS,
  type Job,
  jobById,
  jobsDone,
  jobsOn,
  soloJob,
  townBountyJob,
} from "./jobs";
import { tileKey } from "./keys";
import { jobEarns, PROGRESS, pointsOf, titleOf } from "./levels";
import { JOB_WEAR, JOB_WEAR_INFO, WEAR_ITEMS } from "./looks";
import { replay } from "./replay";
import { dateOfDay, SEASONS, seasonOf, seasonSpan, weekStart } from "./season";
import { expectSupplyHolds, fund, stock } from "./test-support";
import type { TimeOfDay } from "./time-of-day";
import {
  type Command,
  JOB_TITLES,
  SKILLS,
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
};
/** October 4, 2024, a Friday in autumn. */
const DAY = 20_000;
/** The Monday after, when levels and jobs open here, and everyone settled on `DAY` may vote. */
const OPEN = DAY + 3;
const TABLE = JOB_EDITIONS[1] ?? [];
const HOUR = 3_600_000;
const SALT = "0123456789abcdef0123456789abcdef";

/**
 * A world where every input checks the supply identity afterwards (a job never mints, burns, or
 * moves a coin), and every rejection checks that nothing changed at all.
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
  /** The server's clock for game inputs, a second later each time it's read. */
  const tick = () => {
    clock += 1_000;
    return clock;
  };
  return { state, send, ok, code, town, toDay, standAt, tick, day: () => today };
}
type World = ReturnType<typeof world>;

const at = (who: string, dx: number, dy: number) => {
  const [px, py] = PLOTS[who] ?? [0, 0];
  return { x: px * 8 + dx, y: py * 8 + dy };
};

/**
 * Coins, items, the shop, bounties, finds, and recipes open, with Ada and Bob settled before
 * recipes opened, so they know every recipe, and Cy and Dee after, so they know the ones everyone
 * does. Each has a kitchen and a workbench in their hut, a pond beside their hearth, and a fishing
 * rod. Levels open on `OPEN`, a Monday, after all of that, so nobody has a point, and jobs open
 * right after unless `open` is false.
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
  for (const name of ["ada", "bob"]) settle(name);
  w.town({ type: "open_recipes" });
  for (const name of ["cy", "dee"]) settle(name);
  w.toDay(OPEN);
  w.town({ type: "open_levels", firsts: [] });
  if (open) w.town({ type: "open_jobs" });
  return w;
}

const jobEvents = (events: WorldEvent[]) => events.filter((e) => e.type.startsWith("job_"));
const done = (events: WorldEvent[]) => events.find((e) => e.type === "job_done");
/** The job a resident holds, without the `seq` it was taken at. */
const held = (w: World, who: string) => {
  const job = w.state.jobs?.held?.[who];
  if (!job) return undefined;
  const { seq: _seq, ...rest } = job;
  return rest;
};
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

/** Let go of whatever `who` holds, move on to the next day `id` is up, and take it. */
function hold(w: World, who: string, id: string) {
  if (held(w, who)) w.ok(who, { type: "drop_job" });
  until(w, id);
  w.ok(who, { type: "take_job", job: id });
}

/** A resident's bounty posted by `poster` and done by `claimant`, then confirmed. Its last events. */
function bounty(w: World, poster: string, claimant: string) {
  fund(w.state, poster, PROGRESS.bountyMinReward);
  const posted = w
    .ok(poster, { type: "post_bounty", title: "Water my lemons", reward: PROGRESS.bountyMinReward })
    .find((e) => e.type === "bounty_posted");
  const id = posted?.type === "bounty_posted" ? posted.bounty.id : "";
  w.ok(claimant, { type: "claim_bounty", bounty: id });
  w.ok(claimant, { type: "complete_bounty", bounty: id });
  return w.ok(poster, { type: "confirm_bounty", bounty: id, to: claimant });
}

/**
 * A town bounty voted in, claimed by `claimant`, and marked done, waiting on a maintainer. Its id.
 * The vote takes days, so it comes before a job is taken.
 */
function townBounty(w: World, claimant: string) {
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
  w.ok(claimant, { type: "claim_bounty", bounty: id });
  w.ok(claimant, { type: "complete_bounty", bounty: id });
  return id;
}

/** A maintainer pays the town bounty `id` to `to`. */
const payTownBounty = (id: string, to: string): Command => ({
  type: "confirm_town_bounty",
  bounty: id,
  to,
  by: "staff_0123456789ab",
});

/**
 * A Hearth race played to its end: each round every seat makes the choice `choose` gives it, or
 * none for `null`, and the round closes. The last round's events.
 */
function game(w: World, seats: string[], choose: (seat: string) => number | null) {
  const [first = "", ...rest] = seats;
  const opened = w
    .ok(first, { type: "open_table", game: "hearth_race", pace: "slow", salt: SALT, at: w.tick() })
    .find((e) => e.type === "table_opened");
  const table = opened?.type === "table_opened" ? opened.table : "";
  for (const seat of rest) w.ok(seat, { type: "sit", table, at: w.tick() });
  w.ok(first, { type: "start_game", table, at: w.tick() });
  let events: WorldEvent[] = [];
  for (let round = 1; round <= 30 && !events.some((e) => e.type === "game_over"); round++) {
    for (const seat of seats) {
      const move = choose(seat);
      if (move !== null) w.ok(seat, { type: "decide", table, round, move });
    }
    events = w.town({ type: "close_round", table, round, at: w.tick() });
  }
  expect(events.some((e) => e.type === "game_over")).toBe(true);
  return events;
}

/** A Hearth race the first seat wins. The last round's events. */
const race = (w: World, seats: string[]) => game(w, seats, (seat) => (seat === seats[0] ? 3 : 2));

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

const credit = (event: string, guests: string[]): Command => ({
  type: "credit_event",
  event,
  guests,
});

/**
 * Play on, a job on every day one can be taken, until `who` has finished `total` jobs. Their
 * stacks are emptied after each, since months of harvests would fill them.
 */
function playTo(w: World, who: string, total: number) {
  for (let days = 0; jobsDone(w.state, who) < total; days++) {
    // Three a week: a count that stops going up fails here, where it would otherwise never end.
    if (days > total * 7) throw new Error(`${who} is stuck at ${jobsDone(w.state, who)} jobs`);
    if (days > 0) w.toDay();
    if (w.code(who, { type: "take_job", job: doable(w) }) !== null) continue;
    expect(done(finish(w, who, doable(w)))).toBeDefined();
    const things = w.state.items?.inventories[who];
    if (things) things.stacks = {};
  }
}

/**
 * A `profile` that puts on `wear`. The job garment isn't in the wear type until the API opens
 * jobs, so a list that holds it is cast.
 */
const wearing = (...wear: string[]) => ({ type: "profile", wear }) as unknown as Command;

/**
 * Run `test` with `table` as the second edition. No second edition has shipped, so it's put there
 * for the test and taken away after.
 */
function withEdition(table: readonly Job[], test: () => void) {
  const editions = JOB_EDITIONS as Record<number, readonly Job[]>;
  editions[2] = table;
  try {
    test();
  } finally {
    delete editions[2];
  }
}
const edition = (n: unknown) => ({ type: "set_job_edition", edition: n }) as Command;

/**
 * A job for a counted guest and one for a paid bounty. The sim counts both deeds for a job, and no
 * edition of the table asks for either, so the tests that prove them add the two to the board.
 */
const OTIS: readonly Job[] = [
  { id: "otis_guest", giver: "otis", skill: "hosting", deed: { type: "guest", count: 1 } },
  { id: "otis_bounty", giver: "otis", skill: "hosting", deed: { type: "bounty", count: 1 } },
];

/** Run `test` in a world whose board reads the first edition with Otis's two jobs added. */
function withOtis(test: (w: World) => void, { open = true } = {}) {
  withEdition([...TABLE, ...OTIS], () => {
    const w = jobs({ open });
    if (open) w.town(edition(2));
    test(w);
  });
}

/** The world's jobs open, on `day`, to ask it for that day's board. */
const opened = jobs().state;
const boardOn = (day: number) => jobsOn({ ...opened, day });
/** Four years from the day jobs open here, so a leap day is in them. */
const DAYS = Array.from({ length: 1461 }, (_, i) => OPEN + i);
/** How many of those days have a pumpkin or a cranberry job for home. */
const SEASONAL_DAYS = 91;

describe("the numbers", () => {
  it("are pinned, so a change is deliberate and comes with a run of scripts/economy-sim.ts", () => {
    expect(JOBS).toEqual({
      board: 3,
      held: 1,
      perDay: 1,
      perWeek: 3,
      keepDays: 7,
      points: 10,
      titleAt: 10,
      wearAt: 25,
      masterAt: 75,
    });
  });

  it("give two titles and a garment to the count of jobs finished, in fixed words", () => {
    expect(JOB_TITLES).toEqual(["helping_hand", "pillar_of_the_town"]);
    expect(JOB_TITLE_INFO).toEqual({
      helping_hand: { label: "Helping hand", at: "titleAt" },
      pillar_of_the_town: { label: "Pillar of the town", at: "masterAt" },
    });
    // A garment's slot decides which wear lists a logged profile may hold, so it's pinned.
    expect(JOB_WEAR_INFO).toEqual({ town_satchel: { slot: "accessory", label: "Town satchel" } });
    // Until the API opens jobs they're lists of their own, which no title or wear enum holds.
    for (const title of JOB_TITLES) expect(TITLES as readonly string[]).not.toContain(title);
    for (const wear of JOB_WEAR) expect(WEAR_ITEMS as readonly string[]).not.toContain(wear);
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
      "otis_host",
      "pip_game",
      "pip_two_games",
      "pip_win",
    ]);
    // Every word of it: what each job asks, its skill, and when it's up.
    expect(fnv1a(canonicalJson(TABLE))).toBe("15637afd");
  });

  it("keep a job's id to one meaning in every edition that has it", () => {
    // A held job is looked up by id alone, so an edition may drop a job and never redefine one.
    const seen = new Map<string, string>();
    const changed: string[] = [];
    for (const [edition, table] of Object.entries(JOB_EDITIONS)) {
      for (const j of table) {
        const asked = canonicalJson(j);
        if (seen.has(j.id) && seen.get(j.id) !== asked)
          changed.push(`${j.id} in edition ${edition}`);
        seen.set(j.id, asked);
      }
    }
    expect(changed).toEqual([]);
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

  it("has one job for home, one for a walk, and one with neighbors, each day of four years", () => {
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

  it("has one job that needs nothing bought, every day of four years", () => {
    const without = DAYS.filter((day) => !boardOn(day).some(soloJob));
    expect(without).toEqual([]);
    // What that means: a find, a harvest a starter seed grows, or a thing everyone knows how to
    // make from what a first pantry and the land give. No recipe to learn, no rod, and no seed
    // from the shop: pumpkins and cranberries, and the candy and the lantern a pumpkin makes,
    // aren't on the list.
    expect(TABLE.filter(soloJob).map((j) => j.id)).toEqual([
      "juniper_crops",
      "juniper_herbs",
      "juniper_flowers",
      "clem_herb_tea",
      "clem_jam",
      "clem_candy_canes",
      "bram_chair",
      "bram_table",
      "bram_stone_wall",
      "ansel_bouquet",
      "marlo_find",
      "marlo_sand_find",
      "marlo_forest_find",
      "marlo_autumn_find",
    ]);
  });

  it("gives a find for the walk on a day whose jobs would all take something bought, learned, or a rod", () => {
    // Those are the even days when Growing's turn falls on a crop whose seed only the shop sells.
    const seasonal = DAYS.filter((day) =>
      ["juniper_pumpkins", "juniper_cranberries"].includes(boardOn(day)[0]?.id ?? ""),
    );
    expect(seasonal).toHaveLength(SEASONAL_DAYS);
    for (const day of seasonal) {
      const [, walk, neighbors] = boardOn(day);
      expect(day % 2, String(day)).toBe(0);
      expect(walk?.deed?.type, String(day)).toBe("find");
      expect(neighbors?.skill, String(day)).toBe("hosting");
    }
    // Every other even day's walk is a fish, as the lanes' turns have it.
    const evens = DAYS.filter((day) => day % 2 === 0 && !seasonal.includes(day));
    expect(evens.filter((day) => boardOn(day)[1]?.deed?.type !== "fish")).toEqual([]);
    // In a world with no finds out there's no find to give, and the board is as the turns have it.
    const { findsOpen: _findsOpen, ...items } = opened.items ?? {};
    const bare = { ...opened, day: seasonal[0] ?? 0, items } as WorldState;
    expect(jobsOn(bare).map((j) => j.deed?.type)).toEqual(["harvest", "fish", "host"]);
    expect(jobsOn(bare).some(soloJob)).toBe(false);
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
    // Each whole season in the four years: every job with no holiday that's up in it came up.
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
    // With the day it was taken and the input that took it.
    expect(w.state.jobs).toEqual({
      opened: OPEN,
      edition: 1,
      held: { ada: { job: first, day: OPEN, seq: w.state.seq } },
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
    // Monday: a new week, and the count for good goes on.
    expect(w.day()).toBe(OPEN + 7);
    expect(takeAndFinish(w, "ada")).toMatchObject({ week: 1, total: 4 });
    expect(w.state.jobs?.week).toEqual({ start: OPEN + 7, done: { ada: 1 } });
    expect(w.state.jobs?.total).toEqual({ ada: 4, bob: 1 });
    expect(jobsDone(w.state, "ada")).toBe(4);
    expect(jobsDone(w.state, "cy")).toBe(0);
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
        total: 1,
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
        total: 1,
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
    // His autumn job wants a chestnut or a maple leaf, and no other find will do.
    w.toDay();
    const fallen = (kind: string) => kind === "chestnut" || kind === "maple_leaf";
    const other = lying("marlo_autumn_find", (kind) => isFindKind(kind) && !fallen(kind));
    expect(gather(other)).toEqual([]);
    expect(held(w, "ada")).toEqual({ job: "marlo_autumn_find", day: w.day() });
    expect(gather(lying("marlo_autumn_find", fallen))).toMatchObject([
      { type: "job_done", job: "marlo_autumn_find", skill: "foraging" },
    ]);
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
        total: 1,
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

  it("is refused for someone made townsfolk while they held the job", () => {
    const w = jobs();
    until(w, "clem_herb_tea");
    w.ok("bob", { type: "take_job", job: "clem_herb_tea" });
    make(w, "bob", "herb_tea");
    w.town({ type: "set_townsfolk", ids: ["bob"] });
    expect(w.code("bob", { type: "hand_in" })).toBe("not_eligible");
    expect(held(w, "bob")).toEqual({ job: "clem_herb_tea", day: w.day() });
    expect(w.state.jobs?.total).toBeUndefined();
    // Off the list again, the jar he made is his to hand in.
    w.town({ type: "set_townsfolk", ids: [] });
    expect(done(w.ok("bob", { type: "hand_in" }))).toMatchObject({ residentId: "bob", total: 1 });
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

describe("a name every object answers to", () => {
  it("is refused wherever a job, a thing, an edition, or a title is named, with a bring job held", () => {
    const w = jobs();
    hold(w, "ada", "clem_herb_tea");
    make(w, "ada", "herb_tea");
    const before = hashWorld(w.state);
    const names = [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "",
      0,
      2,
      -1,
      1.5,
      null,
    ];
    for (const name of names) {
      const said = JSON.stringify(name);
      const sent = (command: object) => command as Command;
      // Bob holds nothing, so only the name stands between him and a job.
      expect(w.code("bob", sent({ type: "take_job", job: name })), said).toBe("unknown_job");
      expect(w.code("ada", sent({ type: "hand_in", item: name })), said).toBe("nothing_to_hand_in");
      expect(w.code(TOWN_ACTOR, edition(name)), said).toBe("server_only");
      // `null` asks for no title, which is what Ada shows already.
      expect(w.code("ada", sent({ type: "profile", title: name })), said).toBe("invalid_profile");
    }
    expect(hashWorld(w.state)).toBe(before);
    // The job is still hers, and the tea she made still finishes it.
    expect(done(w.ok("ada", { type: "hand_in" }))).toMatchObject({ job: "clem_herb_tea" });
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
    expect(Object.keys(w.state.jobs?.held ?? {})).toEqual(["bob"]);
    expect(held(w, "bob")).toEqual({ job: bobs, day: OPEN + 6 });
    // Nothing is lost: no points, no count against the week, and the next take is free.
    expect(pointsOf(w.state, "ada")).toEqual({});
    expect(w.state.jobs?.week).toBeUndefined();
    expect(w.state.jobs?.total).toBeUndefined();
    expect(takeAndFinish(w, "ada")).toMatchObject({ week: 1, total: 1 });
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

describe("a job with a neighbor", () => {
  it("is done by a lesson that counts: a neighbor with a hearth, outside the teacher's household", () => {
    const w = jobs();
    hold(w, "ada", "otis_teach");
    // Eve has no hearth, so her lesson is a lesson and no more.
    w.ok("eve", { type: "join", name: "eve", kind: "human" });
    w.standAt("eve", 4, 4);
    expect(jobEvents(w.ok("ada", { type: "teach", recipe: "lemonade", to: "eve" }))).toEqual([]);
    expect(held(w, "ada")).toEqual({ job: "otis_teach", day: w.day() });
    // The next day, Cy: a neighbor with a home of her own.
    w.toDay();
    w.standAt("cy", 4, 4);
    const events = w.ok("ada", { type: "teach", recipe: "lemonade", to: "cy" });
    expect(done(events)).toMatchObject({ residentId: "ada", job: "otis_teach", skill: "hosting" });
    // The learner holds the same job, and learning isn't teaching.
    hold(w, "cy", "otis_teach");
    w.standAt("cy", 4, 4);
    w.ok("ada", { type: "teach", recipe: "tomato_sauce", to: "cy" });
    expect(held(w, "cy")).toEqual({ job: "otis_teach", day: w.day() });
  });

  it("is done by a bounty that counts, once a poster a week", () =>
    withOtis((w) => {
      // Bob's bounty counts for Ada's points this week before she takes the job.
      until(w, "otis_bounty");
      bounty(w, "bob", "ada");
      w.ok("ada", { type: "take_job", job: "otis_bounty" });
      // So his second this week doesn't count, for points or for the job. Dee's does.
      expect(jobEvents(bounty(w, "bob", "ada"))).toEqual([]);
      expect(held(w, "ada")).toEqual({ job: "otis_bounty", day: w.day() });
      expect(done(bounty(w, "dee", "ada"))).toMatchObject({
        residentId: "ada",
        job: "otis_bounty",
      });
    }));

  it("is done by the town's bounty too, which a maintainer confirmed", () =>
    withOtis((w) => {
      const id = townBounty(w, "bob");
      hold(w, "bob", "otis_bounty");
      expect(done(w.town(payTownBounty(id, "bob")))).toMatchObject({
        residentId: "bob",
        job: "otis_bounty",
      });
    }));

  it("is done for a guest the server counted, and not for one it left out", () =>
    withOtis((w) => {
      hold(w, "bob", "otis_guest");
      w.ok("cy", { type: "take_job", job: "otis_guest" });
      // The host holds it too, and hosting isn't coming.
      w.ok("ada", { type: "take_job", job: "otis_guest" });
      const event = party(w, "ada", ["bob", "cy"]);
      // Both attended by the sim's samples. The server's list has Bob alone.
      const events = w.town(credit(event, ["bob"]));
      expect(jobEvents(events)).toMatchObject([{ type: "job_done", residentId: "bob" }]);
      expect(held(w, "cy")).toEqual({ job: "otis_guest", day: w.day() });
      expect(held(w, "ada")).toEqual({ job: "otis_guest", day: w.day() });
    }));

  it("is done for a host three guests were counted at, and not for two", () => {
    const w = jobs();
    hold(w, "ada", "otis_host");
    const small = party(w, "ada", ["bob", "cy", "dee"], 10);
    // Three came, and the server counted two of them.
    expect(jobEvents(w.town(credit(small, ["bob", "cy"])))).toEqual([]);
    expect(held(w, "ada")).toEqual({ job: "otis_host", day: w.day() });
    // A second event that day, with all three. A host's points are for one event a day, which is
    // a cap like the daily one: the job is done all the same, and its 10 are all Ada gets here.
    const full = party(w, "ada", ["bob", "cy", "dee"], 12);
    const events = w.town(credit(full, ["bob", "cy", "dee"]));
    expect(jobEvents(events)).toMatchObject([
      { type: "job_done", residentId: "ada", job: "otis_host", skill: "hosting" },
    ]);
    expect(
      events.flatMap((e) => (e.type === "progress" && e.residentId === "ada" ? [e.points] : [])),
    ).toEqual([JOBS.points]);
  });

  it("isn't done by an event that ended before the job was taken, however late its credit comes", () =>
    withOtis((w) => {
      until(w, "otis_guest");
      w.ok("ada", { type: "take_job", job: "otis_guest" });
      w.ok("dee", { type: "take_job", job: "otis_guest" });
      // The event ends, and its credit waits on the server. Meanwhile two guests take Otis's job.
      const event = party(w, "dee", ["ada", "bob", "cy"]);
      w.ok("bob", { type: "take_job", job: "otis_guest" });
      w.ok("cy", { type: "take_job", job: "otis_guest" });
      // Ada held hers through the event. Bob's and Cy's came after it, and stay as they were.
      const events = w.town(credit(event, ["ada", "bob", "cy"]));
      expect(jobEvents(events)).toMatchObject([{ type: "job_done", residentId: "ada" }]);
      expect(held(w, "bob")).toEqual({ job: "otis_guest", day: w.day() });
      expect(held(w, "cy")).toEqual({ job: "otis_guest", day: w.day() });
      // The same for a host: three counted guests at an event that ended before the take.
      hold(w, "dee", "otis_host");
      w.ok("bob", { type: "drop_job" });
      const before = party(w, "bob", ["ada", "cy", "dee"]);
      hold(w, "bob", "otis_host");
      // Cy has held her guest job since before this one, so it's hers. Bob's host job isn't.
      expect(jobEvents(w.town(credit(before, ["ada", "cy", "dee"])))).toMatchObject([
        { type: "job_done", residentId: "cy", job: "otis_guest" },
      ]);
      expect(held(w, "bob")).toEqual({ job: "otis_host", day: w.day() });
    }));

  it("isn't done by an event that ended before jobs opened", () =>
    withOtis(
      (w) => {
        const event = party(w, "ada", ["bob", "cy", "dee"]);
        w.town({ type: "open_jobs" });
        w.town(edition(2));
        until(w, "otis_guest");
        w.ok("bob", { type: "take_job", job: "otis_guest" });
        const events = w.town(credit(event, ["bob", "cy", "dee"]));
        // The credit's points are levels' own. No job hears of it.
        expect(events.some((e) => e.type === "progress")).toBe(true);
        expect(jobEvents(events)).toEqual([]);
        expect(held(w, "bob")).toEqual({ job: "otis_guest", day: w.day() });
      },
      { open: false },
    ));

  it("is done by a bounty whose work came before the take, since the deed it counts is being paid", () =>
    withOtis((w) => {
      until(w, "otis_bounty");
      fund(w.state, "dee", PROGRESS.bountyMinReward);
      const posted = w
        .ok("dee", { type: "post_bounty", title: "Sweep", reward: PROGRESS.bountyMinReward })
        .find((e) => e.type === "bounty_posted");
      const id = posted?.type === "bounty_posted" ? posted.bounty.id : "";
      w.ok("ada", { type: "claim_bounty", bounty: id });
      w.ok("ada", { type: "complete_bounty", bounty: id });
      w.ok("ada", { type: "take_job", job: "otis_bounty" });
      const paid = w.ok("dee", { type: "confirm_bounty", bounty: id, to: "ada" });
      expect(done(paid)).toMatchObject({ residentId: "ada", job: "otis_bounty" });
    }));

  it("is done by a rated game for each seat that chose in it, and Pip's win job only by first place", () => {
    const w = jobs();
    hold(w, "ada", "pip_game");
    w.ok("bob", { type: "take_job", job: "pip_game" });
    w.ok("cy", { type: "take_job", job: "pip_game" });
    // Ada wins, Bob plays, and Cy sits down and never chooses.
    const events = game(w, ["ada", "bob", "cy"], (seat) =>
      seat === "ada" ? 3 : seat === "bob" ? 2 : null,
    );
    expect(jobEvents(events).map((e) => "residentId" in e && e.residentId)).toEqual(["ada", "bob"]);
    expect(held(w, "cy")).toEqual({ job: "pip_game", day: w.day() });
    w.ok("cy", { type: "drop_job" });
    // The win job: the loser's game isn't one.
    hold(w, "ada", "pip_win");
    w.ok("bob", { type: "take_job", job: "pip_win" });
    expect(jobEvents(race(w, ["bob", "ada"]))).toMatchObject([
      { residentId: "bob", job: "pip_win" },
    ]);
    expect(held(w, "ada")).toEqual({ job: "pip_win", day: w.day() });
    expect(jobEvents(race(w, ["ada", "bob"]))).toMatchObject([
      { residentId: "ada", job: "pip_win" },
    ]);
  });

  it("counts two games for the two-game job", () => {
    const w = jobs();
    hold(w, "ada", "pip_two_games");
    expect(jobEvents(race(w, ["bob", "ada"]))).toEqual([
      { type: "job_progress", residentId: "ada", job: "pip_two_games", count: 1, of: 2 },
    ]);
    expect(done(race(w, ["bob", "ada"]))).toMatchObject({ job: "pip_two_games", skill: "playing" });
  });
});

describe("what never moves a job", () => {
  it("anything inside a household: a lesson, a bounty, a game, or an event among themselves", () =>
    withOtis((w) => {
      w.town({ type: "add_owner_pair", pair: ["ada", "cy"] });
      const untouched = (who: string, id: string) =>
        expect(held(w, who), id).toEqual({ job: id, day: w.day() });

      hold(w, "ada", "otis_teach");
      w.standAt("cy", 4, 4);
      expect(jobEvents(w.ok("ada", { type: "teach", recipe: "lemonade", to: "cy" }))).toEqual([]);
      untouched("ada", "otis_teach");

      hold(w, "ada", "otis_bounty");
      expect(jobEvents(bounty(w, "cy", "ada"))).toEqual([]);
      untouched("ada", "otis_bounty");

      // Seats from one household are unrated, and with them out Dee has nobody to be rated against.
      hold(w, "ada", "pip_game");
      w.ok("dee", { type: "take_job", job: "pip_game" });
      expect(jobEvents(race(w, ["ada", "cy", "dee"]))).toEqual([]);
      untouched("ada", "pip_game");
      untouched("dee", "pip_game");
      w.ok("dee", { type: "drop_job" });

      // Cy came to Ada's event, and the sim won't have her on the guest list.
      hold(w, "cy", "otis_guest");
      const event = party(w, "ada", ["cy"]);
      expect(w.code(TOWN_ACTOR, credit(event, ["cy"]))).toBe("not_eligible");
      expect(jobEvents(w.town(credit(event, [])))).toEqual([]);
      untouched("cy", "otis_guest");

      // Three at Ada's event, one of them her own: the list can hold two, which is one short.
      hold(w, "ada", "otis_host");
      const three = party(w, "ada", ["bob", "cy", "dee"]);
      expect(w.code(TOWN_ACTOR, credit(three, ["bob", "cy", "dee"]))).toBe("not_eligible");
      expect(jobEvents(w.town(credit(three, ["bob", "dee"])))).toEqual([]);
      untouched("ada", "otis_host");
      expect(w.state.jobs?.total).toBeUndefined();
    }));

  it("a deed by someone made townsfolk since they took the job", () =>
    withOtis((w) => {
      /** What `deed` does to a job while `who` is on the townsfolk list. */
      const asTownsfolk = (who: string, deed: () => WorldEvent[]) => {
        w.town({ type: "set_townsfolk", ids: [who] });
        const events = jobEvents(deed());
        w.town({ type: "set_townsfolk", ids: [] });
        return events;
      };
      const id = townBounty(w, "dee");
      // A harvest: the townsfolk's doesn't count, and the same resident's next one does.
      hold(w, "ada", "juniper_herbs");
      const [first, second] = ripe(w, "ada", "herb", 2);
      expect(asTownsfolk("ada", () => harvest(w, "ada", first ?? { x: 0, y: 0 }))).toEqual([]);
      expect(held(w, "ada")).toEqual({ job: "juniper_herbs", day: w.day() });
      expect(jobEvents(harvest(w, "ada", second ?? { x: 0, y: 0 }))).toMatchObject([
        { type: "job_progress", count: 1 },
      ]);
      // A craft.
      hold(w, "bob", "bram_chair");
      expect(asTownsfolk("bob", () => make(w, "bob", "chair"))).toEqual([]);
      expect(held(w, "bob")).toEqual({ job: "bram_chair", day: w.day() });
      expect(done(make(w, "bob", "chair"))).toMatchObject({ residentId: "bob" });
      // A fish.
      hold(w, "cy", "sable_dusk_fish");
      expect(asTownsfolk("cy", () => cast(w, "cy", "dusk"))).toEqual([]);
      expect(held(w, "cy")).toEqual({ job: "sable_dusk_fish", day: w.day() });
      expect(done(cast(w, "cy", "dusk"))).toMatchObject({ residentId: "cy" });
      // The town's bounty. A maintainer can't pay one to townsfolk, so no input gets as far as
      // the job. The job's own rule says the same, and so does the rule for a finished job's
      // points, whatever finished it.
      hold(w, "dee", "otis_bounty");
      w.town({ type: "set_townsfolk", ids: ["dee"] });
      expect(w.code(TOWN_ACTOR, payTownBounty(id, "dee"))).toBe("not_eligible");
      expect(townBountyJob(w.state, "dee")).toBeNull();
      expect(jobEarns(w.state, "dee", "hosting", JOBS.points)).toBeNull();
      w.town({ type: "set_townsfolk", ids: [] });
      expect(townBountyJob(w.state, "dee")).not.toBeNull();
      expect(jobEarns(w.state, "dee", "hosting", JOBS.points)).not.toBeNull();
      expect(done(w.town(payTownBounty(id, "dee")))).toMatchObject({ residentId: "dee" });
      expect(w.state.jobs?.total).toEqual({ bob: 1, cy: 1, dee: 1 });
    }));

  it("townsfolk on the other side: nobody teaches them, plays them for a rating, or counts them as guests", () => {
    const w = jobs();
    w.town({ type: "set_townsfolk", ids: ["dee"] });
    // Townsfolk know every recipe, so there's nothing to teach one.
    hold(w, "ada", "otis_teach");
    w.standAt("dee", 4, 4);
    expect(w.code("ada", { type: "teach", recipe: "lemonade", to: "dee" })).toBe("already_known");
    // A lesson from one is a lesson for its learner, and learning moves nothing.
    hold(w, "cy", "otis_teach");
    w.standAt("cy", 5, 4);
    expect(jobEvents(w.ok("dee", { type: "teach", recipe: "lemonade", to: "cy" }))).toEqual([]);
    // A table with townsfolk and one resident rates nobody.
    hold(w, "ada", "pip_game");
    expect(jobEvents(race(w, ["ada", "dee"]))).toEqual([]);
    expect(held(w, "ada")).toEqual({ job: "pip_game", day: w.day() });
    // A townsfolk never posts a bounty, and is never a counted guest.
    fund(w.state, "dee", 5);
    expect(w.code("dee", { type: "post_bounty", title: "Fetch", reward: 5 })).toBe("not_eligible");
    hold(w, "ada", "otis_host");
    const event = party(w, "ada", ["bob", "cy", "dee"]);
    expect(w.code(TOWN_ACTOR, credit(event, ["bob", "cy", "dee"]))).toBe("not_eligible");
    expect(jobEvents(w.town(credit(event, ["bob", "cy"])))).toEqual([]);
    expect(w.state.jobs?.total).toBeUndefined();
  });

  it("a routine's step, which is the server's and no deed", () => {
    const w = jobs();
    until(w, "juniper_herbs");
    w.ok("ada", { type: "take_job", job: "juniper_herbs" });
    const [tile] = ripe(w, "ada", "herb", 1);
    harvest(w, "ada", tile ?? { x: 0, y: 0 });
    w.ok("ada", { type: "set_routines", routines: [{ kind: "walk_home", hour: 1 }] });
    w.ok("ada", { type: "move", dir: "s" });
    w.ok("ada", { type: "leave" });
    const before = canonicalJson(w.state.jobs);
    const events = w.town({
      type: "routine_step",
      resident: "ada",
      routine: "walk_home",
      step: { type: "home" },
    });
    expect(jobEvents(events)).toEqual([]);
    expect(canonicalJson(w.state.jobs)).toBe(before);
    expect(held(w, "ada")).toEqual({ job: "juniper_herbs", day: w.day(), count: 1 });
  });
});

describe("what the count unlocks", () => {
  it("nothing before it's reached, in a world with jobs or without", () => {
    for (const w of [jobs(), jobs({ open: false })]) {
      for (const title of JOB_TITLES) {
        expect(w.code("ada", { type: "profile", title }), title).toBe("not_earned");
      }
      expect(w.code("ada", wearing("town_satchel"))).toBe("not_earned");
      // A newcomer can't arrive wearing it either.
      const arriving = { type: "join", name: "eve", kind: "human", wear: ["town_satchel"] };
      expect(w.code("eve", arriving as unknown as Command)).toBe("not_earned");
    }
  });

  it("a title at 10 jobs finished, a satchel at 25, and a second title at 75, each refused one short", () => {
    const w = jobs();
    const title = (id: string | null) => ({ type: "profile", title: id }) as Command;
    const satchel = wearing("town_satchel");

    playTo(w, "ada", JOBS.titleAt - 1);
    expect(w.code("ada", title("helping_hand"))).toBe("not_earned");
    playTo(w, "ada", JOBS.titleAt);
    expect(w.ok("ada", title("helping_hand"))).toEqual([
      { type: "title_changed", residentId: "ada", title: "helping_hand" },
    ]);
    expect(titleOf(w.state, "ada")).toBe("helping_hand");
    expect(w.code("ada", title("pillar_of_the_town"))).toBe("not_earned");
    expect(w.code("ada", satchel)).toBe("not_earned");
    // Bob, who did none of it, has none of it.
    expect(w.code("bob", title("helping_hand"))).toBe("not_earned");

    playTo(w, "ada", JOBS.wearAt - 1);
    expect(w.code("ada", satchel)).toBe("not_earned");
    playTo(w, "ada", JOBS.wearAt);
    expect(w.ok("ada", satchel)).toMatchObject([
      { type: "profile_changed", residentId: "ada", wear: ["town_satchel"] },
    ]);
    // It takes the accessory slot, and sorts by it.
    expect(w.code("ada", wearing("town_satchel", "basket"))).toBe("invalid_profile");
    w.ok("ada", wearing("town_satchel", "boots", "beret"));
    expect(w.state.residents.ada?.wear).toEqual(["beret", "town_satchel", "boots"]);
    expect(w.code("bob", satchel)).toBe("not_earned");

    playTo(w, "ada", JOBS.masterAt - 1);
    expect(w.code("ada", title("pillar_of_the_town"))).toBe("not_earned");
    playTo(w, "ada", JOBS.masterAt);
    expect(w.ok("ada", title("pillar_of_the_town"))).toEqual([
      { type: "title_changed", residentId: "ada", title: "pillar_of_the_town" },
    ]);
    // Three a week: the 75th comes no sooner than the 25th week.
    expect(w.day() - OPEN).toBeGreaterThanOrEqual(24 * 7);
    expect(jobsDone(w.state, "ada")).toBe(JOBS.masterAt);
  });

  it("shows one title at a time, a skill's or a job's", () => {
    const w = jobs();
    playTo(w, "ada", JOBS.titleAt);
    // Ten jobs for home got Ada to Growing 3 on the way, which is a title of its own.
    const title = (id: string | null) => w.ok("ada", { type: "profile", title: id } as Command);
    title("helping_hand");
    expect(w.state.progress?.titles).toEqual({ ada: "helping_hand" });
    expect(w.code("ada", { type: "profile", title: "helping_hand" })).toBe("invalid_profile");
    expect(title("gardener")).toEqual([
      { type: "title_changed", residentId: "ada", title: "gardener" },
    ]);
    expect(w.state.progress?.titles).toEqual({ ada: "gardener" });
    title("helping_hand");
    expect(title(null)).toEqual([{ type: "title_changed", residentId: "ada", title: null }]);
    expect(w.state.progress?.titles).toBeUndefined();
  });
});

describe("set_job_edition", () => {
  /**
   * Run `test` with a second edition in the table: the first one's jobs with Juniper's herbs and
   * Bram's chair taken out and each lane's order turned round.
   */
  const withSecondEdition = (test: () => void) =>
    withEdition(
      TABLE.filter((j) => j.id !== "juniper_herbs" && j.id !== "bram_chair").reverse(),
      test,
    );

  it("only comes from the server, for jobs that are open and an edition that exists", () => {
    const closed = jobs({ open: false });
    expect(closed.code(TOWN_ACTOR, edition(1))).toBe("not_due");
    const w = jobs();
    expect(w.code("ada", edition(1))).toBe("server_only");
    expect(w.code(TOWN_ACTOR, edition(1))).toBe("already_set");
    for (const n of [2, 0, -1, 1.5, "1", "__proto__", "constructor", null, undefined]) {
      expect(w.code(TOWN_ACTOR, edition(n)), String(n)).toBe("server_only");
    }
    expect(w.state.jobs).toEqual({ opened: OPEN, edition: 1 });
  });

  it("changes the board from then on, and no day before it", () => {
    withSecondEdition(() => {
      const w = jobs();
      const first = board(w);
      const [home = ""] = first;
      w.ok("ada", { type: "take_job", job: home });
      const before = hashWorld(w.state);
      expect(w.town(edition(2))).toEqual([{ type: "job_edition_set", edition: 2 }]);
      expect(w.state.jobs?.edition).toBe(2);
      // The same day reads the other table now.
      const second = board(w);
      expect(second).not.toEqual(first);
      expect(second).toHaveLength(JOBS.board);
      const gone = first.find((id) => !second.includes(id)) ?? "";
      const come = second.find((id) => !first.includes(id)) ?? "";
      expect(w.code("bob", { type: "take_job", job: gone })).toBe("unknown_job");
      w.ok("bob", { type: "take_job", job: come });
      // And back, which is a logged switch like any other.
      w.town(edition(1));
      expect(board(w)).toEqual(first);
      expect(hashWorld(w.state)).not.toBe(before);
    });
  });

  it("replays a take_job logged under the first edition to the same hash after a switch in the same log", () => {
    // The log: a job taken and finished under edition 1, the switch, and a job under edition 2.
    const record = () => {
      const w = jobs();
      const log: { actor: string; command: Command }[] = [];
      const send = (actor: string, command: Command) => {
        w.ok(actor, command);
        log.push({ actor, command });
      };
      const start = w.state.seq;
      until(w, "juniper_herbs");
      const state = JSON.stringify(w.state);
      send("ada", { type: "take_job", job: "juniper_herbs" });
      send("ada", { type: "drop_job" });
      send("bob", { type: "take_job", job: board(w)[1] ?? "" });
      const beforeSwitch = hashWorld(w.state);
      return { w, log, send, start, state, beforeSwitch };
    };
    const replayed = (state: string, log: { actor: string; command: Command }[]) => {
      const world = JSON.parse(state) as WorldState;
      for (const input of log)
        expect(apply(world, input), input.command.type).toMatchObject({ ok: true });
      return hashWorld(world);
    };
    // With only the first edition in the code, the log's first part hashes one way.
    const alone = record();
    expect(replayed(alone.state, alone.log)).toBe(alone.beforeSwitch);
    withSecondEdition(() => {
      // With a second edition in the code and the switch later in the log, it hashes the same way.
      const { w, log, send, state, beforeSwitch } = record();
      expect(beforeSwitch).toBe(alone.beforeSwitch);
      send(TOWN_ACTOR, edition(2));
      // Juniper's herbs are today's job under the first edition and no job at all under the second.
      expect(w.code("ada", { type: "take_job", job: "juniper_herbs" })).toBe("unknown_job");
      send("ada", { type: "take_job", job: board(w)[0] ?? "" });
      const whole = hashWorld(w.state);
      expect(replayed(state, log)).toBe(whole);
      expect(replayed(state, log.slice(0, 3))).toBe(alone.beforeSwitch);
    });
  });

  it("leaves a job held across the switch held, and it still finishes", () => {
    withSecondEdition(() => {
      const w = jobs();
      until(w, "juniper_herbs");
      w.ok("ada", { type: "take_job", job: "juniper_herbs" });
      const [first, ...rest] = ripe(w, "ada", "herb", 3);
      harvest(w, "ada", first ?? { x: 0, y: 0 });
      w.town(edition(2));
      // The second edition has no such job, and Ada's is still hers, count and all.
      expect(JOB_EDITIONS[2]?.some((j) => j.id === "juniper_herbs")).toBe(false);
      expect(held(w, "ada")).toEqual({ job: "juniper_herbs", day: w.day(), count: 1 });
      const events = rest.flatMap((tile) => harvest(w, "ada", tile));
      expect(done(events)).toMatchObject({ job: "juniper_herbs", skill: "growing", total: 1 });
    });
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
  const merging = () => {
    const state = replay(MERGE_CONFIG, MERGE_LOG.slice(0, MERGE));
    send(state, { type: "open_levels", firsts: [] });
    send(state, { type: "open_jobs" });
    const jobs = state.jobs;
    if (!jobs) throw new Error("jobs didn't open");
    return { state, jobs };
  };

  it("adds the duplicate's count of jobs finished, and drops what it held, its day, and its week", () => {
    const { state, jobs } = merging();
    const day = state.day ?? 0;
    jobs.held = {
      [FROM]: { job: "juniper_herbs", day, seq: 1, count: 2 },
      ada: { job: "pip_game", day, seq: 2 },
    };
    jobs.doneToday = [FROM, "ada"].sort();
    jobs.week = { start: weekStart(day), done: { [FROM]: 3, [INTO]: 1 } };
    jobs.total = { [FROM]: 7, [INTO]: 4, ada: 2 };
    const events = send(state, { type: "merge_resident", from: FROM, into: INTO });
    expect(events.filter((e) => e.type.startsWith("job_"))).toEqual([
      { type: "job_total", residentId: INTO, total: 11 },
    ]);
    expect(state.jobs).toEqual({
      opened: day,
      edition: 1,
      held: { ada: { job: "pip_game", day, seq: 2 } },
      doneToday: ["ada"],
      // The record that stays keeps its own week: the duplicate's three don't count against it.
      week: { start: weekStart(day), done: { [INTO]: 1 } },
      total: { [INTO]: 11, ada: 2 },
    });
    expect(JSON.stringify(state.jobs)).not.toContain(FROM);
  });

  it("gives the record that stays its first count, and leaves a world's jobs bare when nothing was held", () => {
    const { state, jobs } = merging();
    const day = state.day ?? 0;
    jobs.held = { [FROM]: { job: "juniper_herbs", day, seq: 1 } };
    jobs.doneToday = [FROM];
    jobs.total = { [FROM]: 10 };
    expect(send(state, { type: "merge_resident", from: FROM, into: INTO })).toContainEqual({
      type: "job_total",
      residentId: INTO,
      total: 10,
    });
    expect(state.jobs).toEqual({ opened: day, edition: 1, total: { [INTO]: 10 } });
    // Ten jobs is a title, and it's the kept record's now.
    const blaze = (command: Command) => apply(state, { actor: INTO, command });
    expect(blaze({ type: "join", name: "Blaze", kind: "agent" }).ok).toBe(true);
    expect(blaze({ type: "profile", title: "helping_hand" })).toMatchObject({
      events: [{ type: "title_changed", residentId: INTO, title: "helping_hand" }],
    });
  });

  it("moves nothing in a world without jobs, or for a duplicate that never finished one", () => {
    const bare = replay(MERGE_CONFIG, MERGE_LOG.slice(0, MERGE));
    expect(
      send(bare, { type: "merge_resident", from: FROM, into: INTO }).some(
        (e) => e.type === "resident_merged",
      ),
    ).toBe(true);
    expect(bare.jobs).toBeUndefined();
    const { state } = merging();
    const events = send(state, { type: "merge_resident", from: FROM, into: INTO });
    expect(events.filter((e) => e.type.startsWith("job_"))).toEqual([]);
    expect(state.jobs).toEqual({ opened: state.day, edition: 1 });
  });
});

describe("retire_repeat_joins", () => {
  it("treats a record with a count of jobs finished as used, and refuses the list", () => {
    const RETIRE = REPEAT_JOINS_LOG.findIndex((i) => i.command.type === "retire_repeat_joins");
    const listed = REPEAT_JOINS_LOG[RETIRE]?.command as Command;
    const world = () => {
      const state = replay(REPEAT_JOINS_CONFIG, REPEAT_JOINS_LOG.slice(0, RETIRE));
      expect(
        apply(state, { actor: TOWN_ACTOR, command: { type: "open_levels", firsts: [] } }).ok,
      ).toBe(true);
      expect(apply(state, { actor: TOWN_ACTOR, command: { type: "open_jobs" } }).ok).toBe(true);
      return state;
    };
    const counted = world();
    if (counted.jobs) counted.jobs.total = { r_pip2: 1 };
    const before = hashWorld(counted);
    expect(apply(counted, { actor: TOWN_ACTOR, command: listed })).toMatchObject({
      rejection: { code: "not_eligible" },
    });
    expect(hashWorld(counted)).toBe(before);
    // With jobs open and nothing to their name, the same list goes.
    expect(apply(world(), { actor: TOWN_ACTOR, command: listed }).ok).toBe(true);
  });
});

describe("the jobs fixture", () => {
  it("replays three weeks of jobs, a merge, a game, a lesson, and a title to the pinned hash", () => {
    const state = replay(JOBS_CONFIG, JOBS_LOG);
    expectSupplyHolds(state);
    expect(state.jobs).toEqual({
      opened: 20_059,
      edition: 1,
      // Nobody holds one: Dee's and Bob's lapsed, and Hal's record is gone.
      doneToday: ["eve"],
      // The fourth week has Eve's tenth job in it. The weeks before are gone.
      week: { start: 20_080, done: { eve: 1 } },
      // Dee's game and her lesson, and Hal's four-leaf clover, which is Gus's now.
      total: { eve: 10, gus: 1, dee: 2 },
    });
    expect(state.progress?.titles).toEqual({ ada: "maker", eve: "helping_hand" });
    // Ten jobs at 10 points on top of her deeds: five for Sable, three for Marlo, and one each
    // for Juniper and Clem.
    expect(state.progress?.points.eve).toEqual({
      growing: 42,
      making: 44,
      foraging: 158,
      hosting: 2,
      playing: 16,
    });
    expect(state.residents.hal).toBeUndefined();
    expect(hashWorld(state)).toBe(JOBS_HASH);
  });
});
