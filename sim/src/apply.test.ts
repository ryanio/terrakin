import { describe, expect, it } from "vitest";
import { apply, prepare } from "./apply";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import type { Command, Input, WorldConfig, WorldState } from "./types";
import { CHAT_EARSHOT, createWorld, spawnTile, withinEarshot } from "./world";

// 3x3 plots of 4 tiles. Commons is plot (1,1), tiles 4..7. Spawn is tile (6,6).
const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};

function run(state: WorldState, actor: string, ...commands: Command[]) {
  return commands.map((command) => apply(state, { actor, command }));
}

function joined(...names: string[]): WorldState {
  const state = createWorld(CONFIG);
  for (const name of names) run(state, name, { type: "join", name, kind: "human" });
  return state;
}

/** Walk `actor` from spawn (6,6) to (2,2), inside plot (0,0). */
function walkToPlotZero(state: WorldState, actor: string) {
  const steps: Command[] = [];
  for (let i = 0; i < 4; i++) steps.push({ type: "move", dir: "w" }, { type: "move", dir: "n" });
  const results = run(state, actor, ...steps);
  expect(results.every((r) => r.ok)).toBe(true);
}

function rejectionCode(result: ReturnType<typeof apply>) {
  return result.ok ? null : result.rejection.code;
}

describe("join and leave", () => {
  it("spawns new residents in the Commons", () => {
    const state = joined("ada");
    expect(state.residents.ada).toMatchObject({ ...spawnTile(CONFIG), online: true });
  });

  it("rejects a second join and actions before joining", () => {
    const state = joined("ada");
    expect(
      rejectionCode(
        apply(state, { actor: "ada", command: { type: "join", name: "x", kind: "human" } }),
      ),
    ).toBe("already_joined");
    expect(rejectionCode(apply(state, { actor: "bob", command: { type: "move", dir: "n" } }))).toBe(
      "not_joined",
    );
  });

  it("validates names", () => {
    const state = createWorld(CONFIG);
    expect(
      rejectionCode(
        apply(state, { actor: "a", command: { type: "join", name: "   ", kind: "agent" } }),
      ),
    ).toBe("invalid_name");
    expect(
      rejectionCode(
        apply(state, {
          actor: "a",
          command: { type: "join", name: "x".repeat(25), kind: "agent" },
        }),
      ),
    ).toBe("invalid_name");
  });

  it("returning residents keep their spot", () => {
    const state = joined("ada");
    run(state, "ada", { type: "move", dir: "e" }, { type: "leave" });
    expect(state.residents.ada?.online).toBe(false);
    run(state, "ada", { type: "join", name: "ada", kind: "human" });
    expect(state.residents.ada).toMatchObject({ x: 7, y: 6, online: true });
  });
});

describe("move", () => {
  it("stops at the edge of the world", () => {
    const state = joined("ada");
    const results = run(
      state,
      "ada",
      ...Array.from({ length: 7 }, () => ({ type: "move", dir: "n" }) as const),
    );
    expect(results.slice(0, 6).every((r) => r.ok)).toBe(true);
    expect(rejectionCode(results[6] as ReturnType<typeof apply>)).toBe("out_of_bounds");
    expect(state.residents.ada?.y).toBe(0);
  });

  it("cannot walk through blocks", () => {
    const state = joined("ada");
    walkToPlotZero(state, "ada");
    run(state, "ada", { type: "claim" }, { type: "place", x: 2, y: 1, block: "stone" });
    expect(rejectionCode(apply(state, { actor: "ada", command: { type: "move", dir: "n" } }))).toBe(
      "blocked",
    );
  });
});

describe("claim", () => {
  it("claims the plot you stand on", () => {
    const state = joined("ada");
    walkToPlotZero(state, "ada");
    const [result] = run(state, "ada", { type: "claim" });
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "plot_claimed", px: 0, py: 0, ownerId: "ada" }],
    });
  });

  it("refuses the Commons", () => {
    const state = joined("ada");
    expect(rejectionCode(apply(state, { actor: "ada", command: { type: "claim" } }))).toBe(
      "plot_is_commons",
    );
  });

  it("refuses an owned plot and enforces the per-resident limit", () => {
    const state = joined("ada", "bob");
    walkToPlotZero(state, "ada");
    walkToPlotZero(state, "bob");
    run(state, "ada", { type: "claim" });
    expect(rejectionCode(apply(state, { actor: "bob", command: { type: "claim" } }))).toBe(
      "plot_owned",
    );
    // Ada walks into plot (0,1) and tries a second claim.
    run(state, "ada", { type: "move", dir: "s" }, { type: "move", dir: "s" });
    expect(rejectionCode(apply(state, { actor: "ada", command: { type: "claim" } }))).toBe(
      "plot_limit",
    );
  });
});

describe("release", () => {
  /** Ada and Bob both walk to plot (0,0); Ada claims it. */
  function claimedPlot() {
    const state = joined("ada", "bob");
    walkToPlotZero(state, "ada");
    walkToPlotZero(state, "bob");
    run(state, "ada", { type: "claim" });
    return state;
  }

  it("releases your plot, clears a hearth on it, and lets someone else claim it", () => {
    const state = claimedPlot();
    run(state, "ada", { type: "set_hearth", x: 1, y: 1 });
    const [released] = run(state, "ada", { type: "release" });
    expect(released).toMatchObject({
      ok: true,
      events: [
        { type: "plot_released", px: 0, py: 0, ownerId: "ada" },
        { type: "hearth_cleared", residentId: "ada" },
      ],
    });
    expect(state.residents.ada?.hearth).toBeNull();
    // Bob claims the freed plot.
    const [claimed] = run(state, "bob", { type: "claim" });
    expect(claimed).toMatchObject({
      ok: true,
      events: [{ type: "plot_claimed", px: 0, py: 0, ownerId: "bob" }],
    });
  });

  it("refuses plots you don't own", () => {
    const state = claimedPlot();
    expect(rejectionCode(apply(state, { actor: "bob", command: { type: "release" } }))).toBe(
      "not_your_plot",
    );
    // Nothing to release on the unclaimed Commons either.
    const fresh = joined("ada");
    expect(rejectionCode(apply(fresh, { actor: "ada", command: { type: "release" } }))).toBe(
      "not_your_plot",
    );
  });

  it("refuses while blocks remain, and rejections change nothing", () => {
    const state = claimedPlot();
    run(state, "ada", { type: "place", x: 0, y: 0, block: "stone" });
    const before = hashWorld(state);
    expect(rejectionCode(apply(state, { actor: "ada", command: { type: "release" } }))).toBe(
      "plot_has_blocks",
    );
    expect(hashWorld(state)).toBe(before);
    run(state, "ada", { type: "remove", x: 0, y: 0 });
    expect(apply(state, { actor: "ada", command: { type: "release" } }).ok).toBe(true);
  });

  it("replays release-then-claim exactly, like a server restart would", () => {
    const state = createWorld(CONFIG);
    const log: Input[] = [];
    const script: Input[] = [
      { actor: "ada", command: { type: "join", name: "ada", kind: "human" } },
      { actor: "bob", command: { type: "join", name: "bob", kind: "human" } },
      ...Array.from({ length: 4 }, (): Input[] => [
        { actor: "ada", command: { type: "move", dir: "w" } },
        { actor: "ada", command: { type: "move", dir: "n" } },
      ]).flat(),
      { actor: "ada", command: { type: "claim" } },
      { actor: "ada", command: { type: "set_hearth", x: 1, y: 1 } },
      { actor: "ada", command: { type: "release" } },
      ...Array.from({ length: 4 }, (): Input[] => [
        { actor: "bob", command: { type: "move", dir: "w" } },
        { actor: "bob", command: { type: "move", dir: "n" } },
      ]).flat(),
      { actor: "bob", command: { type: "claim" } },
    ];
    for (const input of script) {
      const result = apply(state, input);
      expect(result.ok, JSON.stringify(input)).toBe(true);
      log.push(input);
    }
    expect(state.plots).toMatchObject({ "0,0": { px: 0, py: 0, ownerId: "bob" } });
    expect(hashWorld(replay(CONFIG, log))).toBe(hashWorld(state));
  });
});

describe("place and remove", () => {
  it("builds only on your own plot, within reach, on empty tiles", () => {
    const state = joined("ada", "bob");
    walkToPlotZero(state, "ada");
    run(state, "ada", { type: "claim" });

    const place = (actor: string, x: number, y: number) =>
      rejectionCode(apply(state, { actor, command: { type: "place", x, y, block: "wood" } }));

    expect(place("ada", 0, 0)).toBeNull();
    expect(place("ada", 0, 0)).toBe("tile_occupied");
    expect(place("ada", 2, 2)).toBe("tile_occupied"); // Ada is standing there.
    expect(place("ada", 5, 2)).toBe("out_of_reach");
    expect(place("ada", 4, 2)).toBe("not_your_plot");
    expect(place("ada", -1, 0)).toBe("out_of_bounds");
    expect(place("bob", 6, 5)).toBe("not_your_plot"); // The Commons.
  });

  it("removes blocks and reports missing ones", () => {
    const state = joined("ada");
    walkToPlotZero(state, "ada");
    run(state, "ada", { type: "claim" }, { type: "place", x: 1, y: 1, block: "glass" });
    expect(apply(state, { actor: "ada", command: { type: "remove", x: 1, y: 1 } }).ok).toBe(true);
    expect(
      rejectionCode(apply(state, { actor: "ada", command: { type: "remove", x: 1, y: 1 } })),
    ).toBe("no_block");
  });

  it("moves a returning resident to spawn if their spot was built over", () => {
    const state = joined("ada", "bob");
    walkToPlotZero(state, "ada");
    walkToPlotZero(state, "bob");
    run(state, "ada", { type: "claim" });
    run(state, "bob", { type: "move", dir: "w" }, { type: "leave" }); // Bob parks on (1,2) and logs off.
    expect(
      apply(state, { actor: "ada", command: { type: "place", x: 1, y: 2, block: "stone" } }).ok,
    ).toBe(true);
    run(state, "bob", { type: "join", name: "bob", kind: "human" });
    expect(state.residents.bob).toMatchObject(spawnTile(CONFIG));
  });
});

describe("determinism", () => {
  it("rejections never mutate state", () => {
    const state = joined("ada");
    const before = hashWorld(state);
    run(
      state,
      "ada",
      { type: "claim" },
      { type: "remove", x: 0, y: 0 },
      { type: "join", name: "a", kind: "human" },
    );
    expect(hashWorld(state)).toBe(before);
  });

  it("replaying the accepted log reproduces the world exactly", () => {
    const state = createWorld(CONFIG);
    const log: Input[] = [];
    const script: Input[] = [
      { actor: "ada", command: { type: "join", name: "ada", kind: "human" } },
      { actor: "bot", command: { type: "join", name: "helper", kind: "agent" } },
      ...Array.from({ length: 4 }, (): Input[] => [
        { actor: "ada", command: { type: "move", dir: "w" } },
        { actor: "ada", command: { type: "move", dir: "n" } },
      ]).flat(),
      { actor: "ada", command: { type: "claim" } },
      { actor: "ada", command: { type: "place", x: 3, y: 3, block: "leaf" } },
      { actor: "ada", command: { type: "set_hearth", x: 2, y: 2 } },
      { actor: "ada", command: { type: "move", dir: "e" } },
      { actor: "ada", command: { type: "home" } },
      { actor: "ada", command: { type: "profile", color: "plum", note: "x".repeat(80) } },
      { actor: "bot", command: { type: "claim" } }, // Rejected: Commons. Must not enter the log.
      { actor: "bot", command: { type: "leave" } },
    ];
    for (const input of script) if (apply(state, input).ok) log.push(input);

    expect(log).toHaveLength(script.length - 1);
    expect(state.seq).toBe(log.length);
    expect(hashWorld(replay(CONFIG, log))).toBe(hashWorld(state));
  });
});

describe("prepare", () => {
  it("checks without mutating, then commits exactly once", () => {
    const state = joined("ada");
    const before = hashWorld(state);
    const prepared = prepare(state, { actor: "ada", command: { type: "move", dir: "n" } });
    expect(prepared.ok).toBe(true);
    expect(hashWorld(state)).toBe(before);
    if (!prepared.ok) return;
    expect(prepared.commit()).toEqual({
      seq: 2,
      events: [{ type: "moved", residentId: "ada", x: 6, y: 5 }],
    });
    expect(() => prepared.commit()).toThrow();
    expect(state.seq).toBe(2);
  });
});

describe("profile", () => {
  it("gives new residents a stable default look and accepts one on join", () => {
    const a = joined("ada");
    const b = joined("ada");
    expect(a.residents.ada).toMatchObject({ note: "" });
    expect(a.residents.ada?.color).toBe(b.residents.ada?.color);
    const state = createWorld(CONFIG);
    run(state, "wren", {
      type: "join",
      name: "Wren",
      kind: "agent",
      color: "plum",
      shape: "diamond",
      note: "  Ryan's muse  ",
    });
    expect(state.residents.wren).toMatchObject({
      color: "plum",
      shape: "diamond",
      note: "Ryan's muse",
    });
  });

  it("changes only the given fields, keeps them across rejoin, and limits note length", () => {
    const state = joined("ada");
    const before = state.residents.ada?.shape;
    const [result] = run(state, "ada", { type: "profile", color: "sky", note: "loves gardens" });
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "profile_changed", color: "sky", note: "loves gardens" }],
    });
    expect(state.residents.ada?.shape).toBe(before);
    run(state, "ada", { type: "leave" }, { type: "join", name: "ada", kind: "human" });
    expect(state.residents.ada).toMatchObject({ color: "sky", note: "loves gardens" });
    expect(
      rejectionCode(
        apply(state, { actor: "ada", command: { type: "profile", note: "x".repeat(81) } }),
      ),
    ).toBe("invalid_profile");
    const noop = (command: Command) => rejectionCode(apply(state, { actor: "ada", command }));
    expect(noop({ type: "profile" })).toBe("invalid_profile");
    expect(noop({ type: "profile", color: "sky" })).toBe("invalid_profile");
  });
});

describe("hearth", () => {
  function homeowner() {
    const state = joined("ada");
    walkToPlotZero(state, "ada");
    run(state, "ada", { type: "claim" });
    return state;
  }

  it("sets a hearth on your own plot and takes you home", () => {
    const state = homeowner();
    const [set] = run(state, "ada", { type: "set_hearth", x: 1, y: 1 });
    expect(set).toMatchObject({ ok: true, events: [{ type: "hearth_set", x: 1, y: 1 }] });
    run(state, "ada", { type: "move", dir: "e" }, { type: "move", dir: "e" });
    const [home] = run(state, "ada", { type: "home" });
    expect(home).toMatchObject({ ok: true, events: [{ type: "moved", x: 1, y: 1 }] });
  });

  it("rejects hearths off your plot, out of reach, on blocks, and home without one", () => {
    const state = homeowner();
    const code = (command: Command) => rejectionCode(apply(state, { actor: "ada", command }));
    expect(code({ type: "home" })).toBe("no_hearth");
    expect(code({ type: "set_hearth", x: 4, y: 2 })).toBe("not_your_plot");
    expect(code({ type: "set_hearth", x: 2, y: 2 + 3 })).toBe("out_of_reach");
    run(state, "ada", { type: "place", x: 0, y: 0, block: "stone" });
    expect(code({ type: "set_hearth", x: 0, y: 0 })).toBe("tile_occupied");
    run(state, "ada", { type: "set_hearth", x: 1, y: 1 });
    expect(code({ type: "place", x: 1, y: 1, block: "stone" })).toBe("tile_occupied");
  });

  it("rejects no-ops so they never reach the log, and rejections change nothing", () => {
    const state = homeowner();
    run(state, "ada", { type: "set_hearth", x: 1, y: 1 });
    const before = hashWorld(state);
    const code = (command: Command) => rejectionCode(apply(state, { actor: "ada", command }));
    expect(code({ type: "set_hearth", x: 1, y: 1 })).toBe("already_home");
    expect(code({ type: "set_hearth", x: -1, y: 1 })).toBe("out_of_bounds");
    run(state, "ada", { type: "home" });
    const home = hashWorld(state);
    expect(code({ type: "home" })).toBe("already_home");
    expect(hashWorld(state)).toBe(home);
    expect(before).not.toBe(home);
    run(state, "ada", { type: "leave" });
    expect(code({ type: "home" })).toBe("not_joined");
  });

  it("returns a resident to their hearth when their spot was built over", () => {
    const state = joined("ada", "bob");
    walkToPlotZero(state, "ada");
    run(state, "ada", { type: "claim" }, { type: "set_hearth", x: 3, y: 3 });
    // Bob claims plot (1,0); Ada wanders onto it and logs off; Bob builds where she stood.
    run(state, "bob", ...Array.from({ length: 3 }, () => ({ type: "move", dir: "n" }) as const), {
      type: "claim",
    });
    run(
      state,
      "ada",
      { type: "move", dir: "e" },
      { type: "move", dir: "e" },
      { type: "move", dir: "e" },
      { type: "leave" },
    );
    expect(
      apply(state, { actor: "bob", command: { type: "place", x: 5, y: 2, block: "wood" } }).ok,
    ).toBe(true);
    run(state, "ada", { type: "join", name: "ada", kind: "human" });
    expect(state.residents.ada).toMatchObject({ x: 3, y: 3 });
  });
});

describe("withinEarshot", () => {
  it("hears at exactly CHAT_EARSHOT tiles, not one more, in any direction", () => {
    const at = { x: 20, y: 20 };
    expect(withinEarshot(at, at)).toBe(true);
    expect(withinEarshot(at, { x: 20 + CHAT_EARSHOT, y: 20 - CHAT_EARSHOT })).toBe(true);
    expect(withinEarshot(at, { x: 20 + CHAT_EARSHOT + 1, y: 20 })).toBe(false);
    expect(withinEarshot(at, { x: 20, y: 20 - CHAT_EARSHOT - 1 })).toBe(false);
  });
});

// 3x3 plots of 8 tiles, big enough for the starter home. Commons is plot (1,1); spawn is (12,12).
// The starter home on plot (0,0) is the outline of (1,1) to (5,5), door (3,5), hearth (3,3).
const ROOMY: WorldConfig = { ...CONFIG, width: 24, height: 24, plotSize: 8 };

function roomy(...names: string[]): WorldState {
  const state = createWorld(ROOMY);
  for (const name of names) run(state, name, { type: "join", name, kind: "human" });
  return state;
}

function walk(state: WorldState, actor: string, dir: "n" | "s" | "e" | "w", steps: number) {
  const moves = Array.from({ length: steps }, () => ({ type: "move", dir }) as const);
  expect(run(state, actor, ...moves).every((r) => r.ok)).toBe(true);
}

const blockAt = (state: WorldState, x: number, y: number) => state.blocks[`${x},${y}`];

describe("settle", () => {
  it("claims a plot from anywhere and lands on its center", () => {
    const state = roomy("ada");
    const [result] = run(state, "ada", { type: "settle", px: 0, py: 2 });
    expect(result).toEqual({
      ok: true,
      seq: 2,
      events: [
        { type: "plot_claimed", px: 0, py: 2, ownerId: "ada" },
        { type: "moved", residentId: "ada", x: 3, y: 19 },
      ],
    });
    expect(state.plots["0,2"]).toEqual({ px: 0, py: 2, ownerId: "ada" });
  });

  it("rejects bad plots, the Commons, owned plots, a second plot, and strangers", () => {
    const state = roomy("ada", "bob");
    run(state, "ada", { type: "settle", px: 0, py: 0 });
    const before = hashWorld(state);
    const code = (actor: string, px: number, py: number) =>
      rejectionCode(apply(state, { actor, command: { type: "settle", px, py } }));
    expect(code("bob", 3, 0)).toBe("out_of_bounds");
    expect(code("bob", -1, 0)).toBe("out_of_bounds");
    expect(code("bob", 0.5, 0)).toBe("out_of_bounds");
    expect(code("bob", 1, 1)).toBe("plot_is_commons");
    expect(code("bob", 0, 0)).toBe("plot_owned");
    expect(code("ada", 2, 2)).toBe("plot_limit");
    expect(code("eve", 2, 2)).toBe("not_joined");
    expect(hashWorld(state)).toBe(before);
  });

  it("lands on the nearest free tile when someone is on the center, ignoring offline residents", () => {
    const state = roomy("ada", "bob");
    walk(state, "bob", "w", 9);
    walk(state, "bob", "n", 9); // Bob stands on (3,3), the center of plot (0,0).
    const [result] = run(state, "ada", { type: "settle", px: 0, py: 0 });
    // Ring 1 around (3,3), north to south then west to east, starts at (2,2).
    expect(result).toMatchObject({ ok: true, events: [{}, { type: "moved", x: 2, y: 2 }] });

    const quiet = roomy("ada", "bob");
    walk(quiet, "bob", "w", 9);
    walk(quiet, "bob", "n", 9);
    run(quiet, "bob", { type: "leave" });
    run(quiet, "ada", { type: "settle", px: 0, py: 0 });
    expect(quiet.residents.ada).toMatchObject({ x: 3, y: 3 });
  });
});

describe("build_starter_home", () => {
  function settled() {
    const state = roomy("ada", "bob");
    run(state, "ada", { type: "settle", px: 0, py: 0 }); // Ada lands on (3,3), the hearth tile.
    return state;
  }

  it("builds the 15-block hut with glass windows and sets the hearth, without walking", () => {
    const state = settled();
    const [result] = run(state, "ada", { type: "build_starter_home" });
    if (!result?.ok) throw new Error("rejected");
    const placed = result.events.filter((e) => e.type === "block_placed");
    expect(placed).toHaveLength(15);
    expect(result.events.at(-1)).toEqual({ type: "hearth_set", residentId: "ada", x: 3, y: 3 });
    expect(Object.keys(state.blocks)).toHaveLength(15);
    expect(blockAt(state, 1, 1)).toBe("wood");
    expect(blockAt(state, 1, 3)).toBe("glass");
    expect(blockAt(state, 5, 3)).toBe("glass");
    expect(blockAt(state, 3, 5)).toBeUndefined(); // The doorway.
    expect(blockAt(state, 3, 3)).toBeUndefined();
    walk(state, "ada", "s", 3); // Out through the door.
  });

  it("takes wall and window materials", () => {
    const state = settled();
    run(state, "ada", { type: "build_starter_home", walls: "stone", windows: "leaf" });
    expect(blockAt(state, 5, 5)).toBe("stone");
    expect(blockAt(state, 1, 3)).toBe("leaf");
  });

  it("rejects without a plot, when there's nothing left to build, and before joining", () => {
    const state = settled();
    const code = (actor: string) =>
      rejectionCode(apply(state, { actor, command: { type: "build_starter_home" } }));
    expect(code("bob")).toBe("no_plot");
    expect(code("eve")).toBe("not_joined");
    expect(code("ada")).toBeNull();
    const before = hashWorld(state);
    expect(code("ada")).toBe("already_home");
    expect(hashWorld(state)).toBe(before);
  });

  it("skips blocks, hearths, and anyone standing on a wall, and never moves them", () => {
    const state = settled();
    run(state, "ada", { type: "place", x: 1, y: 1, block: "stone" });
    run(state, "ada", { type: "share_plot", with: "bob" });
    walk(state, "bob", "w", 7);
    walk(state, "bob", "n", 8); // Bob stands on (5,4), a wall tile.
    run(state, "bob", { type: "set_hearth", x: 4, y: 5 }); // Bob's hearth sits on a wall tile too.
    const [result] = run(state, "ada", { type: "build_starter_home" });
    if (!result?.ok) throw new Error("rejected");
    expect(result.events.filter((e) => e.type === "block_placed")).toHaveLength(12);
    expect(result.events.some((e) => e.type === "moved")).toBe(false);
    expect(blockAt(state, 1, 1)).toBe("stone");
    expect(blockAt(state, 5, 4)).toBeUndefined();
    expect(blockAt(state, 4, 5)).toBeUndefined();
    expect(state.residents.bob).toMatchObject({ x: 5, y: 4, hearth: { x: 4, y: 5 } });
  });

  it("moves the builder off a wall onto the hearth first, and builds over their old hearth", () => {
    const state = settled();
    run(state, "ada", { type: "set_hearth", x: 1, y: 2 });
    walk(state, "ada", "w", 2); // Ada stands on (1,3), where a window goes.
    const [result] = run(state, "ada", { type: "build_starter_home" });
    if (!result?.ok) throw new Error("rejected");
    expect(result.events[0]).toEqual({ type: "moved", residentId: "ada", x: 3, y: 3 });
    expect(result.events.filter((e) => e.type === "block_placed")).toHaveLength(15);
    expect(blockAt(state, 1, 3)).toBe("glass");
    expect(blockAt(state, 1, 2)).toBe("wood");
    expect(state.residents.ada).toMatchObject({ x: 3, y: 3, hearth: { x: 3, y: 3 } });
  });

  it("leaves the builder's wall open when the hearth tile is blocked", () => {
    const state = settled();
    walk(state, "ada", "w", 2);
    run(state, "ada", { type: "place", x: 3, y: 3, block: "leaf" });
    const [result] = run(state, "ada", { type: "build_starter_home" });
    if (!result?.ok) throw new Error("rejected");
    expect(result.events.map((e) => e.type)).toEqual(Array(14).fill("block_placed"));
    expect(blockAt(state, 1, 3)).toBeUndefined();
    expect(state.residents.ada).toMatchObject({ x: 1, y: 3, hearth: null });
  });

  it("only builds the tiles that fit on a small plot", () => {
    const state = joined("ada"); // 4-tile plots: only 5 wall tiles of plot (0,0) are on it.
    run(state, "ada", { type: "settle", px: 0, py: 0 }); // Center (1,1) is a wall tile.
    expect(state.residents.ada).toMatchObject({ x: 1, y: 1 });
    run(state, "ada", { type: "build_starter_home" });
    expect(Object.keys(state.blocks).sort()).toEqual(["1,1", "1,2", "1,3", "2,1", "3,1"]);
    expect(state.residents.ada).toMatchObject({ x: 3, y: 3, hearth: { x: 3, y: 3 } });
  });
});

describe("share_plot and unshare_plot", () => {
  function couple() {
    const state = roomy("ada", "bob", "cat");
    run(state, "ada", { type: "settle", px: 0, py: 0 });
    const [shared] = run(state, "ada", { type: "share_plot", with: "bob" });
    expect(shared).toMatchObject({
      ok: true,
      events: [{ type: "plot_shared", px: 0, py: 0, residentId: "bob" }],
    });
    return state;
  }

  it("lets a co-owner build, set a hearth, and build the starter home as if it were theirs", () => {
    const state = couple();
    expect(state.plots["0,0"]?.coOwners).toEqual(["bob"]);
    // Bob owns nothing and stands in the Commons; the shared plot is his to build on.
    expect(run(state, "bob", { type: "build_starter_home" })[0]).toMatchObject({ ok: true });
    expect(state.residents.bob?.hearth).toEqual({ x: 3, y: 3 });
    expect(blockAt(state, 1, 1)).toBe("wood");
    run(state, "bob", { type: "home" });
    const ok = (command: Command) => apply(state, { actor: "bob", command }).ok;
    expect(ok({ type: "remove", x: 2, y: 1 })).toBe(true);
    expect(ok({ type: "place", x: 2, y: 1, block: "glass" })).toBe(true);
    expect(ok({ type: "set_hearth", x: 4, y: 4 })).toBe(true);
    // It doesn't count toward Bob's own limit.
    expect(ok({ type: "settle", px: 2, py: 0 })).toBe(true);
  });

  it("keeps everyone's hearth clear on a shared plot", () => {
    const state = couple();
    run(state, "bob", { type: "build_starter_home" }); // Bob's hearth: (3,3), where Ada stands.
    walk(state, "ada", "e", 1);
    const result = apply(state, {
      actor: "ada",
      command: { type: "place", x: 3, y: 3, block: "leaf" },
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: "tile_occupied" } });
    expect(result.ok ? "" : result.rejection.message).toContain("someone's hearth");
  });

  it("doesn't let a co-owner share onward or unshare others", () => {
    const state = couple();
    const code = (command: Command) => rejectionCode(apply(state, { actor: "bob", command }));
    expect(code({ type: "share_plot", with: "cat" })).toBe("not_your_plot");
    expect(code({ type: "unshare_plot", with: "bob" })).toBe("not_your_plot");
  });

  it("rejects self, strangers, repeats, a full plot, no plot, and unknown shares", () => {
    const state = roomy("ada", "bob", "cat", "dan", "eve");
    const code = (command: Command) => rejectionCode(apply(state, { actor: "ada", command }));
    expect(code({ type: "share_plot", with: "bob" })).toBe("no_plot");
    expect(code({ type: "unshare_plot", with: "bob" })).toBe("no_plot");
    run(state, "ada", { type: "settle", px: 0, py: 0 });
    const before = hashWorld(state);
    expect(code({ type: "share_plot", with: "ada" })).toBe("already_shared");
    expect(code({ type: "share_plot", with: "nobody" })).toBe("unknown_resident");
    expect(code({ type: "unshare_plot", with: "bob" })).toBe("not_shared");
    expect(hashWorld(state)).toBe(before);
    for (const who of ["bob", "cat", "dan"]) {
      expect(code({ type: "share_plot", with: who })).toBeNull();
    }
    expect(code({ type: "share_plot", with: "bob" })).toBe("already_shared");
    expect(code({ type: "share_plot", with: "eve" })).toBe("share_limit");
    expect(state.plots["0,0"]?.coOwners).toEqual(["bob", "cat", "dan"]);
  });

  it("lets the owner revoke a share, which takes the co-owner's rights and hearth with it", () => {
    const state = couple();
    run(state, "bob", { type: "build_starter_home" }, { type: "home" });
    const [revoked] = run(state, "ada", { type: "unshare_plot", with: "bob" });
    expect(revoked).toMatchObject({
      ok: true,
      events: [
        { type: "plot_unshared", px: 0, py: 0, residentId: "bob" },
        { type: "hearth_cleared", residentId: "bob" },
      ],
    });
    // No field left behind once the last share goes, so the plot hashes like it was never shared.
    expect(state.plots["0,0"]).toEqual({ px: 0, py: 0, ownerId: "ada" });
    expect(state.residents.bob?.hearth).toBeNull();
    const code = (command: Command) => rejectionCode(apply(state, { actor: "bob", command }));
    expect(code({ type: "place", x: 4, y: 4, block: "wood" })).toBe("not_your_plot");
    expect(code({ type: "remove", x: 2, y: 1 })).toBe("not_your_plot");
    expect(code({ type: "set_hearth", x: 4, y: 4 })).toBe("not_your_plot");
    expect(code({ type: "build_starter_home" })).toBe("no_plot");
    expect(code({ type: "home" })).toBe("no_hearth");
    expect(blockAt(state, 1, 1)).toBe("wood"); // What Bob built stays.
  });

  it("keeps a revoked co-owner's hearth when it's on their own plot", () => {
    const state = couple();
    run(state, "bob", { type: "settle", px: 2, py: 0 }, { type: "build_starter_home" });
    const [revoked] = run(state, "ada", { type: "unshare_plot", with: "bob" });
    expect(revoked).toEqual({
      ok: true,
      seq: state.seq,
      events: [{ type: "plot_unshared", px: 0, py: 0, residentId: "bob" }],
    });
    expect(state.residents.bob?.hearth).toEqual({ x: 19, y: 3 });
  });
});

describe("determinism with settle, sharing, and the starter home", () => {
  it("replays a log that uses the new commands to the same hash", () => {
    const state = createWorld(ROOMY);
    const log: Input[] = [];
    const script: Input[] = [
      { actor: "ada", command: { type: "join", name: "ada", kind: "human" } },
      { actor: "bob", command: { type: "join", name: "bob", kind: "human" } },
      { actor: "wren", command: { type: "join", name: "Wren", kind: "agent" } },
      { actor: "ada", command: { type: "settle", px: 0, py: 0 } },
      { actor: "ada", command: { type: "share_plot", with: "bob" } },
      { actor: "ada", command: { type: "share_plot", with: "wren" } },
      { actor: "wren", command: { type: "build_starter_home", walls: "stone" } },
      { actor: "wren", command: { type: "share_plot", with: "bob" } }, // Rejected: not the owner.
      { actor: "bob", command: { type: "settle", px: 0, py: 0 } }, // Rejected: owned.
      { actor: "bob", command: { type: "settle", px: 0, py: 1 } },
      { actor: "bob", command: { type: "build_starter_home" } },
      { actor: "ada", command: { type: "unshare_plot", with: "wren" } },
      { actor: "ada", command: { type: "build_starter_home" } },
      { actor: "wren", command: { type: "leave" } },
    ];
    for (const input of script) if (apply(state, input).ok) log.push(input);

    expect(log).toHaveLength(script.length - 2);
    expect(state.seq).toBe(log.length);
    expect(hashWorld(replay(ROOMY, log))).toBe(hashWorld(state));
  });
});
