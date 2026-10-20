import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { LANDS_CONFIG, LANDS_HASH, LANDS_LOG } from "./fixtures/lands-log";
import { hashWorld } from "./hash";
import { plotKey } from "./keys";
import { isSea, LANDS, landPlots, onBridge, onLand } from "./lands";
import { replay } from "./replay";
import type { Command, Input, WorldConfig, WorldEvent } from "./types";
import { TOWN_ACTOR } from "./types";
import { route, stepFrom, worldGround } from "./walk";
import { createWorld } from "./world";

/**
 * New lands (RFC 0038). Downtown here is 3 by 3 plots of 8 tiles (24 by 24), with one plot-width
 * of water east of it and a 2 by 2 island beyond, bridged at the Commons' latitude. Small enough
 * to reason about tile by tile, same shape as the live world's recommendation.
 */
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
/** Water is x 24 to 31; the island's plots are columns 4 and 5, rows 0 and 1 (x 32 to 47). */
const ISLAND: Extract<Command, { type: "open_land" }> = {
  type: "open_land",
  land: "willowmere",
  name: "Willowmere",
  width: 48,
  height: 24,
  plots: [
    [4, 0],
    [4, 1],
    [5, 0],
    [5, 1],
  ],
  // The Commons is plot (1, 1), so its latitude is y 8 to 15: bridge along y 11 and 12.
  bridge: [
    [24, 11],
    [24, 12],
    [25, 11],
    [25, 12],
    [26, 11],
    [26, 12],
    [27, 11],
    [27, 12],
    [28, 11],
    [28, 12],
    [29, 11],
    [29, 12],
    [30, 11],
    [30, 12],
    [31, 11],
    [31, 12],
  ],
};

function world() {
  const state = createWorld(CONFIG);
  const log: Input[] = [];
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    else expect(hashWorld(state), "a refusal changed the world").toBe(before);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command).slice(0, 80)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const code = (actor: string, command: Command) => {
    const result = send(actor, command);
    return result.ok ? null : result.rejection.code;
  };
  return { state, log, send, ok, code };
}

describe("old logs", () => {
  it("replay a log with a land, a crossing, and a plot on the far side", () => {
    const state = replay(LANDS_CONFIG, LANDS_LOG);
    expect(hashWorld(state)).toBe(LANDS_HASH);
    // Ada walked over the bridge and stands on the island; Isla lives there.
    expect(state.residents.ada).toMatchObject({ x: 35, y: 12 });
    expect(state.plots[plotKey(4, 0)]?.ownerId).toBe("isla");
  });
});

describe("before any land opens", () => {
  it("has no sea, and the world is what it was", () => {
    const w = world();
    expect(w.state.lands).toBeUndefined();
    for (let x = 0; x < CONFIG.width; x++) {
      for (let y = 0; y < CONFIG.height; y++) expect(isSea(w.state, x, y)).toBe(false);
    }
    // Everything in bounds is downtown, and nothing beyond it is reachable.
    expect(onLand(w.state, 1, 1)).toBe(true);
    expect(onLand(w.state, 4, 0)).toBe(false);
    expect(landPlots(w.state)).toHaveLength(9);
  });
});

describe("open_land", () => {
  it("grows the world, brings its plots, and lays its bridge", () => {
    const w = world();
    const events = w.ok(TOWN_ACTOR, ISLAND);
    expect(events).toEqual([{ ...ISLAND, type: "land_opened" }]);
    expect(w.state.config.width).toBe(48);
    expect(w.state.config.height).toBe(24);
    expect(w.state.lands?.home).toEqual({ width: 24, height: 24 });
    expect(landPlots(w.state)).toHaveLength(13);
    expect(onLand(w.state, 4, 0)).toBe(true);
    expect(onBridge(w.state, 24, 11)).toBe(true);
  });

  it("comes once per land and only from the town", () => {
    const w = world();
    w.ok(TOWN_ACTOR, ISLAND);
    expect(w.code(TOWN_ACTOR, ISLAND)).toBe("already_open");
    const w2 = world();
    expect(w2.code("ada", ISLAND)).toBe("server_only");
  });

  it("refuses a land that doesn't grow the world, or whose plots or bridge are wrong", () => {
    const w = world();
    expect(w.code(TOWN_ACTOR, { ...ISLAND, width: 24 })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { ...ISLAND, width: 16 })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { ...ISLAND, width: 44 })).toBe("server_only");
    // A plot slot that's already downtown, so the land would claim ground twice.
    expect(w.code(TOWN_ACTOR, { ...ISLAND, plots: [[1, 1]] })).toBe("server_only");
    // A plot outside the world the land makes.
    expect(w.code(TOWN_ACTOR, { ...ISLAND, plots: [[9, 0]] })).toBe("server_only");
    // Plots out of order, so one log can't say the same world two ways.
    expect(
      w.code(TOWN_ACTOR, {
        ...ISLAND,
        plots: [
          [5, 0],
          [4, 0],
        ],
      }),
    ).toBe("server_only");
    // A bridge tile on land is a shortcut, not a crossing.
    expect(w.code(TOWN_ACTOR, { ...ISLAND, bridge: [[10, 10]] })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { ...ISLAND, bridge: [[32, 11]] })).toBe("server_only");
    // Nothing of any of that stuck.
    expect(w.state.lands).toBeUndefined();
    expect(w.state.config.width).toBe(24);
  });
});

describe("the water between lands", () => {
  it("is open water nobody walks on, and the bridge is the way across", () => {
    const w = world();
    w.ok(TOWN_ACTOR, ISLAND);
    // Water, except where the bridge runs.
    expect(isSea(w.state, 27, 3)).toBe(true);
    expect(isSea(w.state, 27, 11)).toBe(false);
    expect(isSea(w.state, 35, 3)).toBe(false);
    const ground = worldGround(w.state);
    expect(ground.obstacle(27, 3)).toBe("sea");
    expect(stepFrom(ground, { x: 23, y: 3 }, "e").ok).toBe(false);
    expect(stepFrom(ground, { x: 23, y: 11 }, "e").ok).toBe(true);
  });

  it("leaves a walk to the island, and only over the bridge", () => {
    const w = world();
    w.ok(TOWN_ACTOR, ISLAND);
    const path = route(worldGround(w.state), { x: 12, y: 12 }, { x: 35, y: 12 }, 0, 64);
    expect(path.length).toBeGreaterThan(0);
    // Walk it and check every tile it names is land or bridge, never water.
    const at = { x: 12, y: 12 };
    for (const dir of path) {
      const step = stepFrom(worldGround(w.state), at, dir);
      expect(step.ok, `step ${dir} from ${at.x},${at.y}`).toBe(true);
      if (!step.ok) break;
      at.x = step.to.x;
      at.y = step.to.y;
      expect(isSea(w.state, at.x, at.y)).toBe(false);
    }
    expect(at).toEqual({ x: 35, y: 12 });
  });

  it("refuses settling on water, and takes a plot on the island", () => {
    const w = world();
    w.ok(TOWN_ACTOR, ISLAND);
    w.ok("ada", { type: "join", name: "ada", kind: "agent" });
    // Plot (3, 0) is the water column: in bounds now, and not a plot.
    const wet = w.send("ada", { type: "settle", px: 3, py: 0 });
    expect(wet.ok).toBe(false);
    if (!wet.ok) {
      expect(wet.rejection.code).toBe("out_of_bounds");
      expect(wet.rejection.message).toContain("open water between the lands");
    }
    expect(w.code("ada", { type: "settle", px: 4, py: 0 })).toBe(null);
  });
});

describe("LANDS", () => {
  it("opens the next land while there are still plots to claim", () => {
    // A world that waits for zero turns someone away between the last claim and the next tick.
    expect(LANDS.openAt).toBeGreaterThan(0);
  });
});
