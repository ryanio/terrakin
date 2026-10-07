import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { coinsOf, ECONOMY } from "./economy";
import { hashWorld } from "./hash";
import { tileKey } from "./keys";
import { PUTTER, PUTTER_MAX_STEPS, planPutter } from "./putter";
import { replay } from "./replay";
import {
  type Command,
  type Direction,
  type Input,
  type Tile,
  TOWN_ACTOR,
  type WorldConfig,
} from "./types";
import { chebyshev, cloneWorld, createWorld, plotOf, STEP } from "./world";

/** The world after one six-step putter from spawn, pinned when putter landed. */
const PINNED_PUTTER_HASH = "f6cb4793";

// 3x3 plots of 8 tiles. The Commons is plot (1,1), tiles 8 to 15; spawn is (12,12).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** A world and its log, so every test can replay what it did. */
function world() {
  const state = createWorld(CONFIG);
  const log: Input[] = [];
  const send = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    return result;
  };
  const ok = (actor: string, command: Command) => {
    const result = send(actor, command);
    if (!result.ok) throw new Error(`${command.type} refused: ${result.rejection.message}`);
    return result;
  };
  const join = (id: string, at?: Tile) => {
    ok(id, { type: "join", name: id, kind: "agent" });
    // Tests place residents directly; the sim only reads positions.
    const r = state.residents[id];
    if (r && at) Object.assign(r, at);
  };
  /** Plan a putter the way the server does, and send it. */
  const putter = (actor: string) =>
    send(actor, { type: "putter", steps: planPutter(state, actor) });
  const wall = (...tiles: Tile[]) => {
    for (const t of tiles) state.blocks[tileKey(t.x, t.y)] = "stone";
  };
  return { state, log, send, ok, join, putter, wall };
}

/** Where a list of steps leads, and every tile on the way. */
function walk(from: Tile, steps: Direction[]): Tile[] {
  const tiles: Tile[] = [];
  let at = from;
  for (const dir of steps) {
    const [dx, dy] = STEP[dir];
    at = { x: at.x + dx, y: at.y + dy };
    tiles.push(at);
  }
  return tiles;
}

describe("planPutter", () => {
  it("is deterministic: the same world and resident always give the same walk", () => {
    const w = world();
    w.join("ada", { x: 3, y: 3 });
    w.join("bob", { x: 9, y: 4 });
    const plan = planPutter(w.state, "ada");
    expect(plan.length).toBeGreaterThan(0);
    expect(planPutter(w.state, "ada")).toEqual(plan);
    expect(planPutter(cloneWorld(w.state), "ada")).toEqual(plan);
    // Same inputs from scratch, same walk.
    const again = world();
    again.join("ada", { x: 3, y: 3 });
    again.join("bob", { x: 9, y: 4 });
    expect(planPutter(again.state, "ada")).toEqual(plan);
  });

  it("walks up to the nearest online resident and stops next to them, not on them", () => {
    const w = world();
    w.join("ada", { x: 2, y: 12 });
    w.join("bob", { x: 6, y: 12 });
    w.join("cal", { x: 20, y: 20 });
    const steps = planPutter(w.state, "ada");
    const end = walk({ x: 2, y: 12 }, steps).at(-1);
    expect(end && chebyshev(end, { x: 6, y: 12 })).toBe(1);
  });

  it("walks at most PUTTER.steps tiles toward someone farther away", () => {
    const w = world();
    w.join("ada", { x: 1, y: 1 });
    w.join("bob", { x: 1, y: 12 });
    const steps = planPutter(w.state, "ada");
    expect(steps).toHaveLength(PUTTER.steps);
    const end = walk({ x: 1, y: 1 }, steps).at(-1) as Tile;
    expect(chebyshev(end, { x: 1, y: 12 })).toBe(11 - PUTTER.steps);
  });

  it("ignores offline residents and steps off someone it's standing on", () => {
    const w = world();
    w.join("ada", { x: 12, y: 12 });
    w.join("bob", { x: 12, y: 12 });
    w.join("cal", { x: 14, y: 12 });
    w.ok("cal", { type: "leave" });
    const steps = planPutter(w.state, "ada");
    expect(steps).toHaveLength(1);
    const end = walk({ x: 12, y: 12 }, steps).at(-1) as Tile;
    expect(chebyshev(end, { x: 12, y: 12 })).toBe(1);
  });

  it("goes around blocks and never crosses one or leaves the world", () => {
    const w = world();
    w.join("ada", { x: 0, y: 0 });
    w.join("bob", { x: 4, y: 0 });
    // A wall from the top edge down to y 3 between them.
    w.wall({ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 });
    const steps = planPutter(w.state, "ada");
    const tiles = walk({ x: 0, y: 0 }, steps);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(w.state.blocks[tileKey(t.x, t.y)]).toBeUndefined();
      expect(t.x >= 0 && t.y >= 0 && t.x < CONFIG.width && t.y < CONFIG.height).toBe(true);
    }
    // It heads down the wall toward the gap: six steps can't reach bob yet.
    expect(w.putter("ada").ok).toBe(true);
    expect(w.state.residents.ada).toMatchObject(tiles.at(-1) as Tile);
  });

  it("never ends on a tile where someone else stands", () => {
    const w = world();
    const ids = ["ada", "bob", "cal", "dan", "eve"];
    for (const id of ids) w.join(id);
    for (let round = 0; round < 8; round++) {
      for (const id of ids) {
        expect(w.putter(id).ok).toBe(true);
        const me = w.state.residents[id] as Tile;
        for (const other of ids.filter((o) => o !== id)) {
          const r = w.state.residents[other] as Tile;
          expect(r.x === me.x && r.y === me.y).toBe(false);
        }
      }
    }
  });

  it("with nobody near, visits a neighbor's plot", () => {
    const w = world();
    w.join("ada", { x: 3, y: 3 });
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    w.join("bob", { x: 20, y: 20 });
    w.ok("bob", { type: "settle", px: 1, py: 0 });
    w.ok("bob", { type: "leave" });
    // Ada stands in the middle of her own plot. Her choices: bob's plot, or her own plot's edge.
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const before = { ...(w.state.residents.ada as Tile) };
      const steps = planPutter(w.state, "ada");
      const end = walk(before, steps).at(-1) as Tile;
      const p = plotOf(CONFIG, end.x, end.y);
      seen.add(p.px === 1 ? "bob" : "edge");
      // Bump seq without moving anyone, to see other choices.
      w.ok("ada", { type: "profile", note: `n${i}` });
    }
    expect(seen.has("bob")).toBe(true);
  });

  it("off any plot with nobody near, heads for the Commons", () => {
    const w = world();
    w.join("ada", { x: 1, y: 22 });
    const steps = planPutter(w.state, "ada");
    expect(steps).toHaveLength(PUTTER.steps);
    // Every step is one tile closer to the Commons' nearest corner, (8, 15): diagonally, here.
    const end = walk({ x: 1, y: 22 }, steps).at(-1) as Tile;
    const corner = { x: 8, y: 15 };
    expect(chebyshev(end, corner)).toBe(chebyshev({ x: 1, y: 22 }, corner) - PUTTER.steps);
    expect(steps.every((dir) => dir === "ne")).toBe(true);
  });

  it("in the Commons with nobody near, wanders to an open tile, a different one as seq moves", () => {
    const w = world();
    w.join("ada");
    const ends = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const steps = planPutter(w.state, "ada");
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.length).toBeLessThanOrEqual(PUTTER.steps);
      expect(w.putter("ada").ok).toBe(true);
      const r = w.state.residents.ada as Tile;
      ends.add(tileKey(r.x, r.y));
    }
    expect(ends.size).toBeGreaterThan(1);
  });

  it("is empty when blocks and the edge leave nowhere to go", () => {
    const w = world();
    w.join("ada", { x: 0, y: 0 });
    w.wall({ x: 1, y: 0 }, { x: 0, y: 1 });
    expect(planPutter(w.state, "ada")).toEqual([]);
    expect(planPutter(w.state, "nobody")).toEqual([]);
  });
});

describe("the putter command", () => {
  it("moves one tile per step, with a moved event for each, and seq goes up by one", () => {
    const w = world();
    w.join("ada", { x: 2, y: 12 });
    w.join("bob", { x: 6, y: 12 });
    const steps = planPutter(w.state, "ada");
    const seq = w.state.seq;
    const result = w.putter("ada");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seq).toBe(seq + 1);
    const tiles = walk({ x: 2, y: 12 }, steps);
    expect(result.events).toEqual(
      tiles.map((t) => ({ type: "moved", residentId: "ada", x: t.x, y: t.y })),
    );
    expect(w.state.residents.ada).toMatchObject(tiles.at(-1) as Tile);
  });

  it("refuses with nowhere_to_go and a next step, and changes nothing", () => {
    const w = world();
    w.join("ada", { x: 0, y: 0 });
    w.wall({ x: 1, y: 0 }, { x: 0, y: 1 });
    const before = hashWorld(w.state);
    const result = w.putter("ada");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("nowhere_to_go");
    expect(result.rejection.message).toMatch(/settle at px/);
    expect(hashWorld(w.state)).toBe(before);
  });

  it("names home when the resident has a hearth to jump to", () => {
    const w = world();
    w.join("ada", { x: 3, y: 3 });
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    w.ok("ada", { type: "build_starter_home" });
    // Walk out of the hut and get boxed in by the world's corner.
    Object.assign(w.state.residents.ada as Tile, { x: 23, y: 23 });
    w.wall({ x: 22, y: 23 }, { x: 23, y: 22 });
    const result = w.putter("ada");
    expect(!result.ok && result.rejection.message).toMatch(/Try home/);
  });

  it("refuses bad steps the way move does, and changes nothing", () => {
    const w = world();
    w.join("ada", { x: 0, y: 5 });
    w.wall({ x: 1, y: 5 });
    const before = hashWorld(w.state);
    const code = (steps: Direction[]) => {
      const result = w.send("ada", { type: "putter", steps });
      return result.ok ? null : result.rejection.code;
    };
    expect(code(["w"])).toBe("out_of_bounds");
    expect(code(["e"])).toBe("blocked");
    expect(code(["n", "e", "s"])).toBe("blocked");
    expect(code(["n", "n", "n", "n", "n", "n", "n"])).toBe("out_of_reach");
    expect(code(["up" as Direction])).toBe("out_of_bounds");
    expect(code([])).toBe("nowhere_to_go");
    expect(w.send("cal", { type: "putter", steps: ["n"] }).ok).toBe(false);
    expect(hashWorld(w.state)).toBe(before);
  });

  it("counts as activity and pays the allowance when it ends on the hearth", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "new_day", day: 100 });
    w.ok(TOWN_ACTOR, { type: "open_economy" });
    w.join("ada", { x: 3, y: 3 });
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    // A hearth one step east of where she stands, with today's allowance still due.
    const r = w.state.residents.ada as Tile & { hearth: Tile | null };
    r.hearth = { x: r.x + 1, y: r.y };
    const coins = coinsOf(w.state, "ada");
    const result = w.send("ada", { type: "putter", steps: ["e"] });
    expect(result.ok).toBe(true);
    expect(coinsOf(w.state, "ada")).toBe(coins + ECONOMY.allowance);
    expect(w.state.lastActiveDay?.ada).toBe(100);
  });

  it("keeps accepting the longest walk the sim allows, so old logs replay", () => {
    // PUTTER_MAX_STEPS may go up but never down: a log with a walk this long must keep replaying.
    const w = world();
    w.join("ada");
    const steps: Direction[] = ["n", "n", "e", "e", "s", "s"];
    expect(steps).toHaveLength(PUTTER_MAX_STEPS);
    expect(w.send("ada", { type: "putter", steps }).ok).toBe(true);
    expect(PUTTER.steps).toBeLessThanOrEqual(PUTTER_MAX_STEPS);
    expect(hashWorld(replay(CONFIG, w.log))).toBe(PINNED_PUTTER_HASH);
  });

  it("never heads for someone it's told to avoid, though they still stand where they are", () => {
    // Without the avoid list Ada would walk up to Bob and stop two tiles off, beside him being
    // ruled out; with it she heads for the Commons' west edge (x 8), four or more tiles from him.
    const w = world();
    w.join("ada", { x: 2, y: 12 });
    w.join("bob", { x: 4, y: 6 });
    const steps = planPutter(w.state, "ada", new Set(["bob"]));
    const end = walk({ x: 2, y: 12 }, steps).at(-1) as Tile;
    expect(chebyshev(end, { x: 4, y: 6 })).toBeGreaterThan(2);
  });

  it("never ends next to someone it's told to avoid, whatever the choice falls on", () => {
    // The choice comes from a hash of the actor and the seq, so sweep many of both: a wander
    // toward the Commons ends on its west edge (x 8), where some tiles sit beside bob, and must
    // never stop on one of those.
    for (let n = 0; n < 60; n++) {
      const w = world();
      const me = `r_${n.toString(16).padStart(16, "0")}`;
      w.join(me, { x: 2, y: 12 });
      w.join("bob", { x: 9, y: 12 });
      for (let k = 0; k < n % 7; k++) w.join(`pad${k}`, { x: 30 + k, y: 30 });
      const steps = planPutter(w.state, me, new Set(["bob"]));
      const end = walk({ x: 2, y: 12 }, steps).at(-1) ?? { x: 2, y: 12 };
      expect(chebyshev(end, { x: 9, y: 12 }), me).toBeGreaterThan(1);
    }
  });

  it("replays to the same world", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "new_day", day: 100 });
    w.join("ada");
    w.join("bob");
    for (let i = 0; i < 5; i++) {
      w.putter("ada");
      w.putter("bob");
    }
    expect(w.log.some((i) => i.command.type === "putter")).toBe(true);
    // Positions were only ever changed through logged inputs here, so replay must match.
    expect(hashWorld(replay(CONFIG, w.log))).toBe(hashWorld(w.state));
  });
});
