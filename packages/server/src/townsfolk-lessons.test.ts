import { CARD_RECIPES, knows, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { Api } from "./api";
import { SPECIALTIES } from "./lesson-plan";
import { MemoryMediaStore } from "./media";
import { Moderation } from "./moderation";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { LESSONS, type LessonsMode, lessonsMode, TownsfolkLessons } from "./townsfolk-lessons";
import { DAY_MS, WorldService } from "./world-service";

/**
 * Townsfolk lessons (RFC 0024): each guard refuses before anything is sent, and what does go is
 * an ordinary `teach` the sim checks.
 */

// 3x3 plots of 8 tiles. Everyone who joins without settling stands on the Commons' spawn tile,
// within reach (3) of everyone else there.
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const START = Date.UTC(2026, 9, 5, 9);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/**
 * A world with recipes learned and two townsfolk, Clem and Pip, with their handles, run through
 * an `Api` so lessons are wired as both adapters wire them. Clem stands on the spawn tile; Pip
 * walks off 5 tiles east, out of reach of it.
 */
function town({ mode = "on", recipes = true }: { mode?: LessonsMode; recipes?: boolean } = {}) {
  let now = START;
  const clock = () => now;
  const options = {
    store: new MemoryStore(),
    config: CONFIG,
    now: clock,
    days: true,
    economy: true,
    items: true,
    shop: true,
    recipes,
    presence: true,
  } as const;
  const first = new WorldService(options);
  const join = (world: WorldService, name: string) => {
    const made = world.createResident({ name, kind: "agent" });
    if (!made.ok || !made.residentId) throw new Error(`couldn't join ${name}`);
    return made.residentId;
  };
  const clem = join(first, "Clem");
  const pip = join(first, "Pip");
  const townsfolk = new Set([clem, pip]);
  const world = new WorldService({ ...options, townsfolk });
  world.tick();
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    now: clock,
    resident: (id) => world.state.residents[id],
    townsfolk,
    moderation: new Moderation({ now: clock }),
  });
  for (const [handle, id] of [
    ["clem", clem],
    ["pip", pip],
  ] as const) {
    social.sql.exec(
      "INSERT INTO handles (handle, resident_id, claimed_at, released_at) VALUES (?, ?, 0, 0)",
      handle,
      id,
    );
  }
  const lessons = new TownsfolkLessons({ mode, world, social, townsfolk });
  const api = new Api({ service: world, social, skill: "", openapi: "{}", lessons });
  const as = (id: string, action: Parameters<WorldService["act"]>[1]) => {
    world.arrive(id, action.type);
    const done = world.act(id, action);
    if (!done.ok) throw new Error(done.error.message);
    return done;
  };
  for (const _ of [1, 2, 3, 4, 5]) as(pip, { type: "move", dir: "e" });
  const newcomer = (name: string) => join(world, name);
  const learned = (id: string) => world.state.recipes?.learned[id] ?? [];
  const notices = (id: string) =>
    social.notifications(id, {}).notifications.filter((n) => n.type === "recipe_taught");
  const nextDay = (days = 1) => {
    now += days * DAY_MS;
    world.tick();
  };
  return { world, social, api, lessons, clem, pip, as, newcomer, learned, notices, nextDay };
}

describe("the specialties", () => {
  it("are 2 or 3 recipe cards for each of the eight townsfolk", () => {
    expect(Object.keys(SPECIALTIES).sort()).toEqual(
      ["ansel", "bram", "clem", "juniper", "marlo", "otis", "pip", "sable"].sort(),
    );
    for (const [who, list] of Object.entries(SPECIALTIES)) {
      expect(list.length, who).toBeGreaterThanOrEqual(2);
      expect(list.length, who).toBeLessThanOrEqual(3);
      expect(new Set(list).size, who).toBe(list.length);
      for (const recipe of list) expect(CARD_RECIPES, `${who} ${recipe}`).toContain(recipe);
    }
    // Every card is somebody's specialty, so any recipe can come from a townsfolk.
    expect(new Set(Object.values(SPECIALTIES).flat()).size).toBe(CARD_RECIPES.length);
  });
});

describe("townsfolk lessons", () => {
  it("teach a resident standing near a townsfolk their first specialty, and tell them", () => {
    const t = town();
    const ada = t.newcomer("Ada");
    expect(t.api.runLessons()).toEqual({ taught: 1, codes: [] });
    expect(t.learned(ada)).toEqual(["lemonade"]);
    expect(t.world.state.recipes?.townsfolkTaught).toEqual({ [ada]: t.world.state.day });
    expect(t.notices(ada)).toMatchObject([{ actor: { id: t.clem }, recipe: "lemonade" }]);
  });

  it("come once a week per resident, whatever else they learn in between", () => {
    const t = town();
    const ada = t.newcomer("Ada");
    t.api.runLessons();
    expect(t.api.runLessons()).toEqual({ taught: 0, codes: [] });
    t.nextDay(6);
    t.as(ada, { type: "move", dir: "n" });
    t.as(ada, { type: "move", dir: "s" });
    expect(t.api.runLessons()).toEqual({ taught: 0, codes: [] });
    t.nextDay();
    t.as(ada, { type: "move", dir: "n" });
    expect(t.api.runLessons()).toEqual({ taught: 1, codes: [] });
    expect(t.learned(ada)).toEqual(["lemonade", "tomato_sauce"]);
  });

  it("teach only within reach of where the townsfolk stands", () => {
    const t = town();
    const ada = t.newcomer("Ada");
    for (const _ of [1, 2, 3, 4]) t.as(ada, { type: "move", dir: "w" });
    expect(t.api.runLessons()).toEqual({ taught: 0, codes: [] });
    expect(t.learned(ada)).toEqual([]);
    // Pip stands 5 tiles east of the spawn; one step west of him, Ada is in his reach.
    for (const _ of [1, 2, 3, 4, 5, 6, 7, 8]) t.as(ada, { type: "move", dir: "e" });
    expect(t.api.runLessons()).toEqual({ taught: 1, codes: [] });
    expect(t.learned(ada)).toEqual(["signpost"]);
  });

  it("teach only specialties, and nothing to someone who knows them all", () => {
    const t = town();
    const ada = t.newcomer("Ada");
    for (const recipe of SPECIALTIES.clem) t.as(ada, { type: "pick_recipe", recipe });
    expect(t.api.runLessons()).toEqual({ taught: 0, codes: [] });
    for (const recipe of CARD_RECIPES) {
      const mine = (SPECIALTIES.clem as readonly string[]).includes(recipe);
      expect(knows(t.world.state, ada, recipe), recipe).toBe(mine);
    }
  });

  it("never teach a suspended resident, or across a block either way", () => {
    const t = town();
    const ada = t.newcomer("Ada");
    const bea = t.newcomer("Bea");
    expect(t.social.safety.suspend("system", ada, 3, "Testing.").ok).toBe(true);
    t.social.setBlock(bea, t.clem, true);
    expect(t.api.runLessons()).toEqual({ taught: 0, codes: [] });
    t.social.setBlock(bea, t.clem, false);
    t.social.setBlock(t.clem, bea, true);
    expect(t.api.runLessons()).toEqual({ taught: 0, codes: [] });
    expect(t.learned(ada)).toEqual([]);
    expect(t.learned(bea)).toEqual([]);
  });

  it("never teach someone already taught today", () => {
    const t = town();
    const ada = t.newcomer("Ada");
    const bea = t.newcomer("Bea");
    t.as(bea, { type: "pick_recipe", recipe: "well" });
    t.as(bea, { type: "teach", recipe: "well", to: ada });
    expect(t.api.runLessons()).toEqual({ taught: 1, codes: [] });
    expect(t.learned(ada)).toEqual(["well"]);
    expect(t.learned(bea)).toEqual(["lemonade", "well"]);
  });

  it("wake a townsfolk who's away, as any command of theirs does", () => {
    const t = town();
    // Clem hasn't acted since the server started, so he's away.
    expect(t.world.state.residents[t.clem]?.online).toBe(false);
    const ada = t.newcomer("Ada");
    expect(t.api.runLessons()).toEqual({ taught: 1, codes: [] });
    expect(t.world.state.residents[t.clem]?.online).toBe(true);
    expect(t.learned(ada)).toEqual(["lemonade"]);
  });

  it("give at most a few a run", () => {
    const t = town();
    const many = ["Ada", "Bea", "Cy", "Dee", "Eve"].map((name) => t.newcomer(name));
    for (const _ of [1, 2, 3, 4, 5]) {
      for (const id of many.slice(2)) t.as(id, { type: "move", dir: "e" });
    }
    // Clem has two learners at the spawn and Pip three beside him: one each a run per townsfolk.
    expect(t.api.runLessons()).toMatchObject({ taught: 2 });
    expect(LESSONS.perRun).toBeGreaterThanOrEqual(2);
  });

  it("do nothing while off, while recipes aren't learned, or in a dry run", () => {
    expect(lessonsMode({})).toBe("off");
    expect(lessonsMode({ TERRAKIN_TOWNSFOLK_LESSONS: "on" })).toBe("on");
    expect(lessonsMode({ TERRAKIN_TOWNSFOLK_LESSONS: "loud" })).toBe("off");
    const off = town({ mode: "off" });
    const ada = off.newcomer("Ada");
    expect(off.api.runLessons()).toEqual({ skipped: "off", taught: 0, codes: [] });
    expect(off.learned(ada)).toEqual([]);
    const closed = town({ recipes: false });
    closed.newcomer("Ada");
    expect(closed.api.runLessons()).toEqual({ skipped: "closed", taught: 0, codes: [] });
    const dry = town({ mode: "dry" });
    const bea = dry.newcomer("Bea");
    const seq = dry.world.state.seq;
    expect(dry.api.runLessons()).toEqual({ taught: 1, codes: [] });
    expect(dry.world.state.seq).toBe(seq);
    expect(dry.learned(bea)).toEqual([]);
  });

  it("check each learner once a day in a dry run, so the townsfolk can go idle", () => {
    const t = town({ mode: "dry" });
    t.newcomer("Bea");
    expect(t.api.runLessons()).toEqual({ taught: 1, codes: [] });
    // The next minute's run has nothing new to check, and doesn't act as Clem.
    expect(t.api.runLessons()).toEqual({ taught: 0, codes: [] });
    // Someone new still gets checked the same day, and Bea again the next day.
    t.newcomer("Cy");
    expect(t.api.runLessons()).toEqual({ taught: 1, codes: [] });
    expect(t.api.runLessons()).toEqual({ taught: 0, codes: [] });
    t.nextDay();
    expect(t.api.runLessons()).toMatchObject({ taught: 1 });
  });

  it("run from the minute sweep", () => {
    const t = town();
    const ada = t.newcomer("Ada");
    t.api.sweep();
    expect(t.learned(ada)).toEqual(["lemonade"]);
  });
});
