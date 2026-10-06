import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import {
  type Command,
  type Input,
  PLOT_NAME_MAX_LENGTH,
  type WorldConfig,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

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

function settled(...names: string[]): WorldState {
  const state = createWorld(CONFIG);
  for (const name of names) run(state, name, { type: "join", name, kind: "human" });
  run(state, "ada", { type: "settle", px: 0, py: 0 });
  return state;
}

function code(result: ReturnType<typeof apply>) {
  return result.ok ? null : result.rejection.code;
}

describe("name_plot", () => {
  it("names the owner's plot and renames it, trimming the name", () => {
    const state = settled("ada");
    const [named] = run(state, "ada", { type: "name_plot", name: "  Sunpatch  " });
    expect(named).toMatchObject({
      ok: true,
      events: [{ type: "plot_named", px: 0, py: 0, name: "Sunpatch" }],
    });
    expect(state.plots["0,0"]?.name).toBe("Sunpatch");
    const [renamed] = run(state, "ada", { type: "name_plot", name: "Moonpatch" });
    expect(renamed).toMatchObject({
      ok: true,
      events: [{ type: "plot_named", px: 0, py: 0, name: "Moonpatch" }],
    });
    expect(state.plots["0,0"]?.name).toBe("Moonpatch");
  });

  it("names the owner's first plot when they're not standing on it", () => {
    const state = settled("ada");
    // Walk ada off her plot into the Commons.
    run(state, "ada", ...Array.from({ length: 4 }, () => ({ type: "move", dir: "e" }) as const));
    const [named] = run(state, "ada", { type: "name_plot", name: "Faraway" });
    expect(named).toMatchObject({
      ok: true,
      events: [{ type: "plot_named", px: 0, py: 0, name: "Faraway" }],
    });
  });

  it("clears the name with an empty name", () => {
    const state = settled("ada");
    run(state, "ada", { type: "name_plot", name: "Sunpatch" });
    expect(state.plots["0,0"]?.name).toBe("Sunpatch");
    const [cleared] = run(state, "ada", { type: "name_plot", name: "   " });
    expect(cleared).toMatchObject({
      ok: true,
      events: [{ type: "plot_named", px: 0, py: 0, name: "" }],
    });
    expect(state.plots["0,0"]).not.toHaveProperty("name");
  });

  it("refuses a name over the cap and leaves state byte-identical", () => {
    const state = settled("ada");
    const before = hashWorld(state);
    expect(
      code(apply(state, { actor: "ada", command: { type: "name_plot", name: "x".repeat(25) } })),
    ).toBe("name_too_long");
    expect(hashWorld(state)).toBe(before);
    const [ok] = run(state, "ada", { type: "name_plot", name: "x".repeat(PLOT_NAME_MAX_LENGTH) });
    expect(ok?.ok).toBe(true);
  });

  it("refuses a non-owner, a co-owner, and a plotless resident", () => {
    const state = settled("ada", "bob");
    run(state, "ada", { type: "share_plot", with: "bob" });
    const before = hashWorld(state);
    // Bob shares the plot but doesn't own it.
    expect(code(apply(state, { actor: "bob", command: { type: "name_plot", name: "Mine" } }))).toBe(
      "not_your_plot",
    );
    // Bob releases nothing: use a fresh world where he joined but owns no plot.
    const state2 = settled("ada", "bob");
    expect(
      code(apply(state2, { actor: "bob", command: { type: "name_plot", name: "Mine" } })),
    ).toBe("no_plot");
    expect(hashWorld(state)).toBe(before);
  });

  it("replays a naming log to the same hash", () => {
    const state = createWorld(CONFIG);
    const log: Input[] = [];
    const script: Input[] = [
      { actor: "ada", command: { type: "join", name: "ada", kind: "human" } },
      { actor: "ada", command: { type: "settle", px: 0, py: 0 } },
      { actor: "ada", command: { type: "name_plot", name: "Sunpatch" } },
      { actor: "ada", command: { type: "name_plot", name: "Moonpatch" } },
      { actor: "ada", command: { type: "name_plot", name: "" } },
    ];
    for (const input of script) {
      const result = apply(state, input);
      expect(result.ok, JSON.stringify(input)).toBe(true);
      log.push(input);
    }
    expect(state.plots["0,0"]).not.toHaveProperty("name");
    expect(hashWorld(replay(CONFIG, log))).toBe(hashWorld(state));
  });
});
