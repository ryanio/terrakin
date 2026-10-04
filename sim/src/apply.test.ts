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
