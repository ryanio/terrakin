import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { PRESENCE_CONFIG, PRESENCE_HASH, PRESENCE_LOG } from "./fixtures/presence-log";
import { ROUTINES_CONFIG, ROUTINES_HASH, ROUTINES_LOG } from "./fixtures/routines-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import { planStroll, ROUTINES, routineRanToday, routinesOf, strollBack } from "./routines";
import { expectSupplyHolds } from "./test-support";
import {
  type Command,
  type Direction,
  type Routine,
  type RoutineStep,
  type StepRoutine,
  TOWN_ACTOR,
  type WorldState,
} from "./types";
import { canBuildOn, plotAtTile } from "./world";

const act = (state: WorldState, actor: string, command: Command) =>
  apply(state, { actor, command });
const town = (state: WorldState, command: Command) => act(state, TOWN_ACTOR, command);
const code = (result: ReturnType<typeof apply>) => (result.ok ? null : result.rejection.code);

const step = (resident: string, routine: StepRoutine, s: RoutineStep): Command => ({
  type: "routine_step",
  resident,
  routine,
  step: s,
});
const home = (resident: string) => step(resident, "walk_home", { type: "home" });
const stroll = (resident: string, steps: Direction[]) =>
  step(resident, "stroll", { type: "putter", steps });

/**
 * The presence world on a new day: Bob is away, a step west of his hearth in his hut on plot (2, 0),
 * with `walk_home` and `stroll` on. Coins and items are open, and today's allowance and pantry are
 * due to him.
 */
function world(
  routines: Routine[] = [
    { kind: "walk_home", hour: 18 },
    { kind: "stroll", hour: 19 },
  ],
): WorldState {
  const state = replay(PRESENCE_CONFIG, PRESENCE_LOG);
  expect(hashWorld(state)).toBe(PRESENCE_HASH);
  if (routines.length > 0) {
    expect(act(state, "bob", { type: "set_routines", routines }).ok).toBe(true);
    expect(town(state, { type: "leave_idle", ids: ["bob"] }).ok).toBe(true);
  }
  expect(town(state, { type: "new_day", day: (state.day ?? 0) + 1 }).ok).toBe(true);
  return state;
}

/** Refused with `want`, and the world exactly as it was. */
function refused(state: WorldState, actor: string, command: Command, want: string) {
  const before = hashWorld(state);
  expect(code(act(state, actor, command)), JSON.stringify(command)).toBe(want);
  expect(hashWorld(state)).toBe(before);
}

describe("the routines fixture", () => {
  it("replays to its pinned hash, with the older log under it unchanged", () => {
    expect(hashWorld(replay(PRESENCE_CONFIG, PRESENCE_LOG))).toBe(PRESENCE_HASH);
    const state = replay(ROUTINES_CONFIG, ROUTINES_LOG);
    expect(hashWorld(state)).toBe(ROUTINES_HASH);
    expectSupplyHolds(state);
    expect(state.routines).toEqual({
      ada: [{ kind: "stroll", hour: 7 }],
      cy: [
        { kind: "walk_home", hour: 17 },
        { kind: "greet", max: 2 },
      ],
      dee: [{ kind: "greet", max: 3 }],
    });
  });
});

describe("set_routines", () => {
  it("keeps one of each kind in menu order, and tells only its resident", () => {
    const state = world([]);
    const result = act(state, "bob", {
      type: "set_routines",
      routines: [
        { kind: "greet", max: 2 },
        { kind: "walk_home", hour: 6 },
      ],
    });
    const mine = [
      { kind: "walk_home", hour: 6 },
      { kind: "greet", max: 2 },
    ];
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "joined" }, { type: "routines_set", residentId: "bob", routines: mine }],
    });
    expect(routinesOf(state, "bob")).toEqual(mine);
  });

  it("refuses the list already set, and turns everything off with []", () => {
    const state = world();
    refused(
      state,
      "bob",
      {
        type: "set_routines",
        routines: [
          { kind: "stroll", hour: 19 },
          { kind: "walk_home", hour: 18 },
        ],
      },
      "already_set",
    );
    expect(act(state, "bob", { type: "set_routines", routines: [] }).ok).toBe(true);
    expect(state.routines).toBeUndefined();
    refused(state, "bob", { type: "set_routines", routines: [] }, "already_set");
  });

  it("refuses anything off the menu", () => {
    const state = world([]);
    const bad: unknown[] = [
      "walk_home",
      [{ kind: "nap", hour: 3 }],
      [{ kind: "walk_home", hour: 24 }],
      [{ kind: "walk_home", hour: -1 }],
      [{ kind: "stroll", hour: 7.5 }],
      [{ kind: "stroll" }],
      [{ kind: "greet", max: 0 }],
      [{ kind: "greet", max: ROUTINES.greetMostMax + 1 }],
      [
        { kind: "greet", max: 1 },
        { kind: "greet", max: 2 },
      ],
      [{ kind: "greet", max: 1 }, { kind: "stroll", hour: 1 }, { kind: "walk_home", hour: 2 }, 4],
    ];
    for (const routines of bad) {
      refused(state, "bob", { type: "set_routines", routines } as Command, "invalid_routine");
    }
  });
});

describe("routine_step", () => {
  it("walks an absent resident home with no allowance, no pantry, and no activity", () => {
    const state = world();
    const purse = state.economy?.coins.bob;
    const lastActive = state.lastActiveDay?.bob;
    const things = JSON.stringify(state.items?.inventories.bob);
    const result = town(state, home("bob"));
    expect(result).toEqual({
      ok: true,
      seq: state.seq,
      events: [{ type: "moved", residentId: "bob", x: 19, y: 3, routine: "walk_home" }],
    });
    expect(state.residents.bob).toMatchObject({ x: 19, y: 3, online: false });
    expect(state.economy?.coins.bob).toBe(purse);
    expect(state.lastActiveDay?.bob).toBe(lastActive);
    expect(JSON.stringify(state.items?.inventories.bob)).toBe(things);
    expect(routineRanToday(state, "bob", "walk_home")).toBe(true);
    expectSupplyHolds(state);
    // Their own `home` on the hearth still collects today's allowance when they come back.
    const back = act(state, "bob", { type: "home" });
    expect(back.ok && back.events.some((e) => e.type === "coins" && e.reason === "allowance")).toBe(
      true,
    );
  });

  it("refuses a routine already home, even with the allowance due", () => {
    const state = world();
    expect(town(state, home("bob")).ok).toBe(true);
    expect(town(state, { type: "new_day", day: (state.day ?? 0) + 1 }).ok).toBe(true);
    refused(state, TOWN_ACTOR, home("bob"), "already_home");
  });

  it("refuses what the resident didn't choose, or while they're here", () => {
    const state = world([{ kind: "walk_home", hour: 18 }]);
    refused(state, "bob", home("bob"), "server_only");
    refused(state, TOWN_ACTOR, home("zed"), "unknown_resident");
    refused(state, TOWN_ACTOR, stroll("bob", ["s"]), "not_set");
    refused(state, TOWN_ACTOR, home("cy"), "not_set");
    refused(
      state,
      TOWN_ACTOR,
      step("bob", "walk_home", { type: "putter", steps: [] }),
      "invalid_routine",
    );
    refused(
      state,
      TOWN_ACTOR,
      step("bob", "greet" as StepRoutine, { type: "home" }),
      "invalid_routine",
    );
    expect(act(state, "bob", { type: "profile", note: "here now" }).ok).toBe(true);
    refused(state, TOWN_ACTOR, home("bob"), "awake");
  });

  it("goes home once a day, and again the next", () => {
    const state = world();
    expect(town(state, home("bob")).ok).toBe(true);
    expect(town(state, stroll("bob", ["s"])).ok).toBe(true);
    refused(state, TOWN_ACTOR, home("bob"), "ran_today");
    expect(town(state, { type: "new_day", day: (state.day ?? 0) + 1 }).ok).toBe(true);
    expect(town(state, home("bob")).ok).toBe(true);
  });

  it("strolls at most a day's tiles over its legs, on plots the resident can build on", () => {
    const state = world();
    expect(town(state, home("bob")).ok).toBe(true);
    const out = town(state, stroll("bob", ["s", "s", "s", "s"]));
    expect(out).toMatchObject({
      ok: true,
      events: [
        { type: "moved", residentId: "bob", x: 19, y: 4, routine: "stroll" },
        { type: "moved", residentId: "bob", x: 19, y: 5, routine: "stroll" },
        { type: "moved", residentId: "bob", x: 19, y: 6, routine: "stroll" },
        { type: "moved", residentId: "bob", x: 19, y: 7, routine: "stroll" },
      ],
    });
    // Plot (2, 0) ends at y 7: a step south is someone else's ground.
    refused(state, TOWN_ACTOR, stroll("bob", ["s"]), "not_your_plot");
    refused(state, TOWN_ACTOR, stroll("bob", ["n", "n", "n", "n", "n"]), "ran_today");
    expect(town(state, stroll("bob", ["n", "n", "n", "n"])).ok).toBe(true);
    expect(state.residents.bob).toMatchObject({ x: 19, y: 3 });
    refused(state, TOWN_ACTOR, stroll("bob", ["s"]), "ran_today");
  });

  it("meets every check the resident's own walk would", () => {
    const state = world();
    // From his hearth, inside his hut: walls on three sides, the doorway to the south.
    expect(town(state, home("bob")).ok).toBe(true);
    refused(state, TOWN_ACTOR, stroll("bob", []), "nowhere_to_go");
    refused(state, TOWN_ACTOR, stroll("bob", ["s", "s", "s", "s", "n", "n", "n"]), "out_of_reach");
    refused(state, TOWN_ACTOR, stroll("bob", ["n", "n"]), "blocked");
    refused(state, TOWN_ACTOR, stroll("bob", ["up" as Direction]), "out_of_bounds");
    // Away from a plot they can build on, a stroll can't start.
    const off = world([{ kind: "stroll", hour: 19 }]);
    const bob = off.residents.bob;
    if (bob) Object.assign(bob, { x: 12, y: 12 });
    refused(off, TOWN_ACTOR, stroll("bob", ["n"]), "not_your_plot");
  });

  it("needs a world that counts days, and a hearth to walk home to", () => {
    const state = world([{ kind: "walk_home", hour: 18 }]);
    const bob = state.residents.bob;
    if (bob) bob.hearth = null;
    refused(state, TOWN_ACTOR, home("bob"), "no_hearth");
    delete state.day;
    refused(state, TOWN_ACTOR, home("bob"), "not_due");
  });
});

describe("the stroll planner", () => {
  it("plans a walk out the sim accepts, and the way back to where it started", () => {
    const state = world();
    expect(town(state, home("bob")).ok).toBe(true);
    const out = planStroll(state, "bob");
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(ROUTINES.strollOut);
    // The same world plans the same walk.
    expect(planStroll(state, "bob")).toEqual(out);
    expect(town(state, stroll("bob", out)).ok).toBe(true);
    const bob = state.residents.bob;
    expect(canBuildOn(plotAtTile(state, bob?.x ?? 0, bob?.y ?? 0), "bob")).toBe(true);
    const back = strollBack(state, "bob", { x: 19, y: 3 });
    expect(out.length + back.length).toBeLessThanOrEqual(ROUTINES.strollTiles);
    expect(town(state, stroll("bob", back)).ok).toBe(true);
    expect(state.residents.bob).toMatchObject({ x: 19, y: 3 });
  });

  it("plans nothing off a plot the resident can build on", () => {
    const state = world();
    const bob = state.residents.bob;
    if (bob) Object.assign(bob, { x: 12, y: 12 });
    expect(planStroll(state, "bob")).toEqual([]);
    expect(strollBack(state, "bob", { x: 19, y: 3 })).toEqual([]);
  });
});
