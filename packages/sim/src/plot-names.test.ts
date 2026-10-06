import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import {
  FREE_RENAMES_CONFIG,
  FREE_RENAMES_HASH,
  FREE_RENAMES_LOG,
} from "./fixtures/free-renames-log";
import { PLOT_NAMES_CONFIG, PLOT_NAMES_HASH, PLOT_NAMES_LOG } from "./fixtures/plot-names-log";
import { VISIT_CONFIG, VISIT_LOG } from "./fixtures/visit-log";
import { hashWorld } from "./hash";
import { PLOT_NAMES } from "./plot-names";
import { replay } from "./replay";
import { type Command, type RejectionCode, TOWN_ACTOR, type WorldState } from "./types";
import { createWorld } from "./world";

/**
 * The visit world: Ada owns plot (0, 0) and shares it with Cy, Bob owns (2, 0), Cy (0, 2), Dee
 * (1, 0), and Clem the bare plot (2, 2). The Commons is (1, 1). Presence comes with acting.
 */
const visitWorld = (): WorldState => replay(VISIT_CONFIG, VISIT_LOG);

function act(state: WorldState, actor: string, command: Command) {
  const result = apply(state, { actor, command });
  if (!result.ok) throw new Error(`${actor} ${command.type}: ${result.rejection.message}`);
  return result.events;
}

/** A refusal with this code that leaves the world exactly as it was, and its message. */
function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
  return result.ok ? "" : result.rejection.message;
}

const name = (px: number, py: number, value: string | null): Command => ({
  type: "name_plot",
  px,
  py,
  name: value,
});

const nextDay = (state: WorldState) =>
  act(state, TOWN_ACTOR, { type: "new_day", day: (state.day ?? 0) + 1 });

describe("the plot names log", () => {
  it("replays to the hash pinned when names landed, every input accepted", () => {
    const state = createWorld(PLOT_NAMES_CONFIG);
    for (const input of PLOT_NAMES_LOG) {
      const result = apply(state, input);
      expect(result.ok, JSON.stringify(input.command)).toBe(true);
    }
    expect(hashWorld(state)).toBe(PLOT_NAMES_HASH);
    expect(state.plots["0,0"]).toMatchObject({
      name: "The Lemon Grove",
      namedBy: "cy",
      namedDay: 20016,
    });
    expect(state.plots["2,0"]).toMatchObject({ name: "Bob's Workshop", namedBy: "bob" });
    // Staff took Cy's down: the day it was named stays, the words and who wrote them go.
    expect(state.plots["0,2"]).toEqual({
      px: 0,
      py: 2,
      ownerId: "cy",
      claimedDay: 20000,
      namedDay: 20015,
    });
    // Released and claimed again: a new plot, with nothing of the old name.
    expect(state.plots["2,2"]).toEqual({ px: 2, py: 2, ownerId: "clem", claimedDay: 20015 });
  });
});

describe("the free renames log", () => {
  it("replays the names from before free renames as they were, then the renames, to the hash pinned", () => {
    const state = createWorld(FREE_RENAMES_CONFIG);
    for (const [i, input] of FREE_RENAMES_LOG.entries()) {
      const result = apply(state, input);
      expect(result.ok, JSON.stringify(input.command)).toBe(true);
      if (i === PLOT_NAMES_LOG.length - 1) expect(hashWorld(state)).toBe(PLOT_NAMES_HASH);
    }
    expect(hashWorld(state)).toBe(FREE_RENAMES_HASH);
    // Ada's shared plot: Cy's name changed the day it was given, and again the next day.
    expect(state.plots["0,0"]).toMatchObject({
      name: "Ada's Lemon Grove",
      namedBy: "ada",
      namedDay: 20017,
      freeRenamesUsed: 2,
    });
    // Bob's renamed on a day it hadn't changed yet, which used none of the two he'd spent.
    expect(state.plots["2,0"]).toMatchObject({ name: "Bob's Workshop", freeRenamesUsed: 2 });
    // Cy's came down after one free rename, and keeps the day and the count.
    expect(state.plots["0,2"]).toEqual({
      px: 0,
      py: 2,
      ownerId: "cy",
      claimedDay: 20000,
      namedDay: 20016,
      freeRenamesUsed: 1,
    });
    // Released and claimed again: a new plot, whose free renames start over.
    expect(state.plots["2,2"]).toMatchObject({ name: "Clem's Corner", freeRenamesUsed: 1 });
  });
});

describe("naming a plot", () => {
  it("names it from anywhere, trimmed, for everyone to see, and keeps who and when", () => {
    const state = visitWorld();
    // Cy stands on Bob's plot, far from her own.
    expect(act(state, "cy", name(0, 2, "  Moss Hollow  "))).toEqual([
      { type: "plot_named", px: 0, py: 2, name: "Moss Hollow", by: "cy", day: state.day },
    ]);
    expect(state.plots["0,2"]).toMatchObject({
      name: "Moss Hollow",
      namedBy: "cy",
      namedDay: state.day,
    });
  });

  it("lets a resident the plot is shared with name it, until the share is taken back", () => {
    const state = visitWorld();
    act(state, "cy", name(0, 0, "Our Lemon Grove"));
    expect(state.plots["0,0"]).toMatchObject({ name: "Our Lemon Grove", namedBy: "cy" });
    nextDay(state);
    act(state, "ada", { type: "unshare_plot", with: "cy" });
    // The name stays: it's the plot's now. Cy can't change it any more.
    expect(state.plots["0,0"]?.name).toBe("Our Lemon Grove");
    refused(state, "cy", name(0, 0, "Cy's Grove"), "not_your_plot");
  });

  it("refuses a plot outside the world, the Commons, a free plot, and someone else's", () => {
    const state = visitWorld();
    refused(state, "ada", name(3, 0, "Far Away"), "out_of_bounds");
    refused(state, "ada", name(-1, 0, "Far Away"), "out_of_bounds");
    refused(state, "ada", name(0.5, 0, "Far Away"), "out_of_bounds");
    refused(state, "ada", name(1, 1, "Ada's Square"), "plot_is_commons");
    act(state, "clem", { type: "release" });
    refused(state, "ada", name(2, 2, "Nobody's"), "plot_unclaimed");
    // Bob doesn't live on Ada's plot, and Ada doesn't share Bob's.
    refused(state, "bob", name(0, 0, "Bob Was Here"), "not_your_plot");
    refused(state, "ada", name(2, 0, "Ada Was Here"), "not_your_plot");
  });

  it("refuses an empty name, a blank one, one too long, and anything that isn't text, and takes the longest", () => {
    const state = visitWorld();
    refused(state, "ada", name(0, 0, ""), "invalid_name");
    refused(state, "ada", name(0, 0, "    "), "invalid_name");
    refused(state, "ada", name(0, 0, "x".repeat(PLOT_NAMES.max + 1)), "invalid_name");
    const odd = { type: "name_plot", px: 0, py: 0, name: 7 } as unknown as Command;
    refused(state, "ada", odd, "invalid_name");
    const longest = "x".repeat(PLOT_NAMES.max);
    act(state, "ada", name(0, 0, longest));
    expect(state.plots["0,0"]?.name).toBe(longest);
  });

  it("changes once a world day, plus two free renames the plot's residents share", () => {
    const state = visitWorld();
    act(state, "ada", name(0, 0, "Ada's Lemn Grove"));
    // The typo needn't wait for tomorrow: a change the same day takes a free rename.
    expect(act(state, "ada", name(0, 0, "Ada's Lemon Grove"))).toEqual([
      {
        type: "plot_named",
        px: 0,
        py: 0,
        name: "Ada's Lemon Grove",
        by: "ada",
        day: state.day,
        freeRenamesLeft: 1,
      },
    ]);
    refused(state, "cy", name(0, 0, "Ada's Lemon Grove"), "already_set");
    expect(act(state, "cy", name(0, 0, "Our Lemon Grove"))).toContainEqual(
      expect.objectContaining({ type: "plot_named", by: "cy", freeRenamesLeft: 0 }),
    );
    // With both used, a third change today waits, from the owner or a co-owner.
    const limit = refused(state, "ada", name(0, 0, "Ada's Grove"), "rename_limit");
    expect(limit).toContain("no free renames left");
    refused(state, "cy", name(0, 0, "Ada's Grove"), "rename_limit");
    nextDay(state);
    // A new day needs no free rename. Ada stands on her hearth, so the new day's allowance comes
    // with it, as with any command.
    expect(act(state, "ada", name(0, 0, "Ada's Lemon Grove"))).toContainEqual({
      type: "plot_named",
      px: 0,
      py: 0,
      name: "Ada's Lemon Grove",
      by: "ada",
      day: state.day,
    });
    expect(state.plots["0,0"]).toMatchObject({ namedDay: state.day, freeRenamesUsed: 2 });
    // They don't come back.
    refused(state, "ada", name(0, 0, "Ada's Grove"), "rename_limit");
  });

  it("names freely in a world that doesn't count days", () => {
    const state = createWorld(VISIT_CONFIG);
    act(state, "ivy", { type: "join", name: "Ivy", kind: "human" });
    act(state, "ivy", { type: "settle", px: 0, py: 0 });
    act(state, "ivy", name(0, 0, "Ivy's"));
    expect(act(state, "ivy", name(0, 0, "Ivy's Garden"))).toEqual([
      { type: "plot_named", px: 0, py: 0, name: "Ivy's Garden", by: "ivy" },
    ]);
    expect(state.plots["0,0"]).not.toHaveProperty("namedDay");
  });
});

describe("clearing a plot's name", () => {
  it("takes the words down at any time, keeps the day, and makes no room for a new name", () => {
    const state = visitWorld();
    act(state, "bob", name(2, 0, "Bob's Workshop"));
    expect(act(state, "bob", name(2, 0, null))).toEqual([
      { type: "plot_named", px: 2, py: 0, name: null, by: "bob" },
    ]);
    expect(state.plots["2,0"]).not.toHaveProperty("name");
    expect(state.plots["2,0"]).not.toHaveProperty("namedBy");
    expect(state.plots["2,0"]?.namedDay).toBe(state.day);
    // A free rename changes a name that's up, so the plot keeps both for another day.
    const limit = refused(state, "bob", name(2, 0, "Bob's Shed"), "rename_limit");
    expect(limit).toContain("2 free renames left, but those only change a name that's up");
    refused(state, "bob", name(2, 0, null), "already_set");
    refused(state, "ada", name(2, 0, null), "not_your_plot");
  });
});

describe("releasing a named plot", () => {
  it("drops its name with it, so whoever claims it next starts with none", () => {
    const state = visitWorld();
    act(state, "clem", name(2, 2, "Quiet Corner"));
    expect(act(state, "clem", { type: "release" }).map((e) => e.type)).toEqual(["plot_released"]);
    expect(state.plots["2,2"]).toBeUndefined();
    act(state, "clem", { type: "claim" });
    expect(state.plots["2,2"]).toEqual({ px: 2, py: 2, ownerId: "clem", claimedDay: state.day });
  });
});

describe("staff clearing a name (clear_plot_name)", () => {
  it("comes only from the server, and only for a plot with a name", () => {
    const state = visitWorld();
    act(state, "cy", name(0, 2, "Moss Hollow"));
    refused(state, "cy", { type: "clear_plot_name", px: 0, py: 2 }, "server_only");
    refused(state, TOWN_ACTOR, { type: "clear_plot_name", px: 2, py: 0 }, "already_set");
    refused(state, TOWN_ACTOR, { type: "clear_plot_name", px: 1, py: 1 }, "plot_is_commons");
    refused(state, TOWN_ACTOR, { type: "clear_plot_name", px: 9, py: 9 }, "out_of_bounds");
    act(state, "clem", { type: "release" });
    refused(state, TOWN_ACTOR, { type: "clear_plot_name", px: 2, py: 2 }, "plot_unclaimed");
  });

  it("takes the name and its writer down, and keeps the day so no new name goes up today", () => {
    const state = visitWorld();
    act(state, "cy", name(0, 2, "Moss Hollow"));
    expect(act(state, TOWN_ACTOR, { type: "clear_plot_name", px: 0, py: 2 })).toEqual([
      { type: "plot_name_removed", px: 0, py: 2 },
    ]);
    expect(state.plots["0,2"]).not.toHaveProperty("name");
    expect(state.plots["0,2"]).not.toHaveProperty("namedBy");
    refused(state, "cy", name(0, 2, "Moss Hollow Again"), "rename_limit");
    nextDay(state);
    act(state, "cy", name(0, 2, "Fern Hollow"));
  });
});
