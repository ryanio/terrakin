import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { WALK_CONFIG, WALK_HASH, WALK_LOG } from "./fixtures/walk-log";
import { hashWorld } from "./hash";
import { tileKey } from "./keys";
import { planPutter } from "./putter";
import { replay } from "./replay";
import {
  type Command,
  type Direction,
  type Input,
  type Tile,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
import { DIRECTIONS, directionOf, route, stepFrom, walkTree, worldGround } from "./walk";
import { chebyshev, createWorld, STEP, shopTiles, townHallTiles } from "./world";

// 3x3 plots of 8 tiles. The Commons is plot (1,1), tiles 8 to 15; spawn is (12,12). The Town Hall
// stands on x 11 to 13, y 8 and 9 (its door at (12,9)); the shop on x 11 to 13, y 14 and 15.
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** A world and its log. Every rejection must leave the world exactly as it was. */
function world() {
  const state = createWorld(CONFIG);
  const log: Input[] = [];
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    else expect(hashWorld(state)).toBe(before);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const refusal = (actor: string, command: Command) => {
    const result = send(actor, command);
    return result.ok ? null : { code: result.rejection.code, message: result.rejection.message };
  };
  /** Join, then walk to `at` one logged step at a time, so replay puts them there too. */
  const join = (id: string, at?: Tile) => {
    ok(id, { type: "join", name: id, kind: "agent" });
    if (at)
      for (const dir of route(worldGround(state), here(id), at)) ok(id, { type: "move", dir });
    expect(here(id)).toEqual(at ?? { x: 12, y: 12 });
  };
  const here = (id: string): Tile => {
    const r = state.residents[id];
    return { x: r?.x ?? -1, y: r?.y ?? -1 };
  };
  const move = (id: string, dir: Direction) => send(id, { type: "move", dir });
  const town = (command: Command) => ok(TOWN_ACTOR, command);
  /** Days, coins, and items, then the shop. */
  const openShop = () => {
    town({ type: "new_day", day: 20_000 });
    town({ type: "open_economy" });
    town({ type: "open_items" });
    town({ type: "open_shop" });
  };
  return { state, log, send, ok, refusal, join, here, move, town, openShop };
}

const onHall = (t: Tile) => townHallTiles(CONFIG).some((h) => h.x === t.x && h.y === t.y);

describe("stepFrom", () => {
  it("steps one tile in each of the eight directions", () => {
    const ground = worldGround(createWorld(CONFIG));
    for (const dir of DIRECTIONS) {
      const [dx, dy] = STEP[dir];
      expect(stepFrom(ground, { x: 12, y: 12 }, dir)).toEqual({
        ok: true,
        to: { x: 12 + dx, y: 12 + dy },
      });
      expect(directionOf(dx, dy)).toBe(dir);
    }
    expect(DIRECTIONS).toHaveLength(8);
    expect(directionOf(0, 0)).toBeUndefined();
    expect(directionOf(2, 1)).toBeUndefined();
  });

  it("stops at the world's edge, diagonals too", () => {
    const ground = worldGround(createWorld(CONFIG));
    const code = (dir: Direction) => {
      const step = stepFrom(ground, { x: 0, y: 0 }, dir);
      return step.ok ? null : step.code;
    };
    for (const dir of ["n", "w", "nw", "ne", "sw"] as const)
      expect(code(dir)).toBe("out_of_bounds");
    for (const dir of ["s", "e", "se"] as const) expect(code(dir)).toBeNull();
  });

  it("never steps into a block, or diagonally past one's corner or between two", () => {
    const state = createWorld(CONFIG);
    const from = { x: 12, y: 12 };
    const step = (dir: Direction) => stepFrom(worldGround(state), from, dir);
    state.blocks[tileKey(13, 11)] = "stone";
    expect(step("ne")).toMatchObject({ ok: false, code: "blocked", obstacle: "block" });
    expect(step("n").ok && step("e").ok).toBe(true);
    // A block beside the diagonal: its corner is in the way.
    delete state.blocks[tileKey(13, 11)];
    state.blocks[tileKey(13, 12)] = "wood";
    expect(step("ne")).toEqual({
      ok: false,
      code: "blocked",
      message: "A block's corner is in the way. Step around it.",
      obstacle: "block",
    });
    expect(step("se").ok).toBe(false);
    expect(step("nw").ok && step("sw").ok).toBe(true);
    // Two blocks touching at their corners leave no gap to slip through.
    state.blocks[tileKey(12, 11)] = "wood";
    expect(step("ne").ok).toBe(false);
  });
});

describe("move", () => {
  it("takes all eight directions, one tile and one moved event each", () => {
    const w = world();
    w.join("ada");
    for (const dir of DIRECTIONS) {
      const from = w.here("ada");
      const [dx, dy] = STEP[dir];
      expect(w.ok("ada", { type: "move", dir })).toEqual([
        { type: "moved", residentId: "ada", x: from.x + dx, y: from.y + dy },
      ]);
    }
  });

  it("refuses a diagonal past a corner with the sim's words, and changes nothing", () => {
    const w = world();
    w.join("ada");
    w.state.blocks[tileKey(12, 11)] = "stone";
    expect(w.refusal("ada", { type: "move", dir: "ne" })).toEqual({
      code: "blocked",
      message: "A block's corner is in the way. Step around it.",
    });
    expect(w.refusal("ada", { type: "move", dir: "up" as Direction })?.code).toBe("out_of_bounds");
    expect(w.here("ada")).toEqual({ x: 12, y: 12 });
  });
});

describe("solid buildings", () => {
  it("let residents walk across the Town Hall and the shop until the server says otherwise", () => {
    const w = world();
    w.openShop();
    w.join("ada", { x: 12, y: 10 });
    expect(w.move("ada", "n").ok).toBe(true);
    expect(w.move("ada", "n").ok).toBe(true);
    expect(onHall(w.here("ada"))).toBe(true);
    w.join("bob", { x: 12, y: 13 });
    expect(w.move("bob", "s").ok).toBe(true);
    expect(worldGround(w.state).obstacle(12, 9)).toBeUndefined();
  });

  it("come only from the server, once", () => {
    const w = world();
    w.join("ada");
    expect(w.refusal("ada", { type: "solid_buildings" })?.code).toBe("server_only");
    expect(w.town({ type: "solid_buildings" })).toEqual([{ type: "buildings_solid" }]);
    expect(w.state.solidBuildings).toBe(true);
    expect(w.refusal(TOWN_ACTOR, { type: "solid_buildings" })?.code).toBe("already_open");
  });

  it("step everyone on a building off to the nearest open tile, online or not", () => {
    const w = world();
    w.openShop();
    w.join("ada", { x: 12, y: 10 });
    w.ok("ada", { type: "move", dir: "n" });
    w.join("bob", { x: 12, y: 7 });
    w.ok("bob", { type: "move", dir: "s" });
    w.ok("bob", { type: "leave" });
    w.join("cal", { x: 12, y: 13 });
    w.ok("cal", { type: "move", dir: "s" });
    w.join("dee", { x: 5, y: 5 });
    expect(w.town({ type: "solid_buildings" })).toEqual([
      { type: "buildings_solid" },
      // Straight out of the door, out the back, and out of the shop's door.
      { type: "moved", residentId: "ada", x: 12, y: 10 },
      { type: "moved", residentId: "bob", x: 12, y: 7 },
      { type: "moved", residentId: "cal", x: 12, y: 13 },
    ]);
    expect(w.here("dee")).toEqual({ x: 5, y: 5 });
    // Bob comes back where he was moved to, not inside the hall.
    w.ok("bob", { type: "join", name: "bob", kind: "agent" });
    expect(w.here("bob")).toEqual({ x: 12, y: 7 });
  });

  it("then stop every step onto them, straight or past a corner", () => {
    const w = world();
    w.openShop();
    w.town({ type: "solid_buildings" });
    w.join("ada", { x: 12, y: 10 });
    expect(w.refusal("ada", { type: "move", dir: "n" })).toEqual({
      code: "blocked",
      message: "The Town Hall is in the way.",
    });
    expect(w.move("ada", "nw").ok || w.move("ada", "ne").ok).toBe(false);
    w.join("bob", { x: 10, y: 9 });
    expect(w.refusal("bob", { type: "move", dir: "se" })).toEqual({
      code: "blocked",
      message: "The Town Hall's corner is in the way. Step around it.",
    });
    w.join("cal", { x: 12, y: 13 });
    expect(w.refusal("cal", { type: "move", dir: "s" })?.message).toBe("The shop is in the way.");
    // Putter steps are checked the same way.
    expect(w.refusal("ada", { type: "putter", steps: ["n"] })?.code).toBe("blocked");
    expect(w.refusal("ada", { type: "putter", steps: ["w", "w", "ne"] })?.code).toBe("blocked");
    expect(w.refusal("ada", { type: "putter", steps: ["w", "w", "n"] })).toBeNull();
  });

  it("make the shop a building only once it opens, stepping anyone there off it", () => {
    const w = world();
    w.town({ type: "solid_buildings" });
    w.join("ada", { x: 12, y: 13 });
    expect(w.move("ada", "s").ok).toBe(true);
    expect(shopTiles(CONFIG).some((t) => t.x === 12 && t.y === 14)).toBe(true);
    w.town({ type: "new_day", day: 20_000 });
    w.town({ type: "open_economy" });
    w.town({ type: "open_items" });
    expect(w.town({ type: "open_shop" })).toEqual([
      { type: "shop_opened" },
      { type: "moved", residentId: "ada", x: 12, y: 13 },
    ]);
    expect(w.move("ada", "s").ok).toBe(false);
  });

  it("replay to the same world, diagonals and all", () => {
    const w = world();
    w.openShop();
    w.join("ada", { x: 12, y: 10 });
    w.ok("ada", { type: "move", dir: "n" });
    w.join("bob", { x: 3, y: 4 });
    w.town({ type: "solid_buildings" });
    for (const dir of ["ne", "se", "sw", "nw", "e"] as const) w.ok("bob", { type: "move", dir });
    for (let i = 0; i < 3; i++) {
      w.send("ada", { type: "putter", steps: planPutter(w.state, "ada") });
      w.send("bob", { type: "putter", steps: planPutter(w.state, "bob") });
    }
    expect(hashWorld(replay(CONFIG, w.log))).toBe(hashWorld(w.state));
  });
});

describe("the walking log", () => {
  it("replays to its pinned hash, with everyone on a building stepped off", () => {
    const state = replay(WALK_CONFIG, WALK_LOG);
    expect(hashWorld(state)).toBe(WALK_HASH);
    expect(state.solidBuildings).toBe(true);
    expect(state.residents.eve).toMatchObject({ x: 15, y: 7 });
    expect(state.residents.fay).toMatchObject({ x: 13, y: 12, online: true });
  });
});

describe("walks over the rule", () => {
  const solid = () => {
    const w = world();
    w.openShop();
    w.town({ type: "solid_buildings" });
    return w;
  };

  /** Every tile a list of steps passes, after checking each step is one the sim takes. */
  const follow = (ground: ReturnType<typeof worldGround>, from: Tile, steps: Direction[]) => {
    const tiles: Tile[] = [];
    let at = from;
    for (const dir of steps) {
      const step = stepFrom(ground, at, dir);
      expect(step.ok, `${dir} from ${at.x},${at.y}`).toBe(true);
      if (step.ok) at = step.to;
      tiles.push(at);
    }
    return tiles;
  };

  it("route goes around the Town Hall in the fewest steps", () => {
    const w = solid();
    const ground = worldGround(w.state);
    const from = { x: 12, y: 10 };
    const to = { x: 12, y: 7 };
    const steps = route(ground, from, to);
    const tiles = follow(ground, from, steps);
    expect(tiles.at(-1)).toEqual(to);
    expect(tiles.some(onHall)).toBe(false);
    const fewest = walkTree(ground, from, 24).find((n) => n.x === to.x && n.y === to.y)?.steps;
    expect(steps).toHaveLength(fewest ?? -1);
    // Straight through would be 3; around the corners takes longer.
    expect(steps.length).toBeGreaterThan(3);
  });

  it("route stops once within reach, and gets as close as it can to somewhere shut in", () => {
    const w = world();
    const ground = worldGround(w.state);
    const steps = route(ground, { x: 2, y: 2 }, { x: 12, y: 2 }, 3);
    expect(steps).toHaveLength(7);
    expect(chebyshev(follow(ground, { x: 2, y: 2 }, steps).at(-1) as Tile, { x: 12, y: 2 })).toBe(
      3,
    );
    // A ring of blocks around (20, 20): the closest you get is next to it.
    for (let y = 19; y <= 21; y++)
      for (let x = 19; x <= 21; x++)
        if (x !== 20 || y !== 20) w.state.blocks[tileKey(x, y)] = "stone";
    const shut = worldGround(w.state);
    const end = follow(shut, { x: 15, y: 20 }, route(shut, { x: 15, y: 20 }, { x: 20, y: 20 })).at(
      -1,
    );
    expect(end && chebyshev(end, { x: 20, y: 20 })).toBe(2);
    // Already as close as it gets: no walk.
    expect(route(shut, { x: 18, y: 20 }, { x: 20, y: 20 })).toEqual([]);
  });

  it("walkTree stays inside its radius and the world", () => {
    const ground = worldGround(createWorld(CONFIG));
    const nodes = walkTree(ground, { x: 1, y: 1 }, 3);
    expect(nodes).toHaveLength(5 * 5);
    for (const n of nodes) expect(n.x >= 0 && n.y >= 0 && n.x <= 4 && n.y <= 4).toBe(true);
  });

  it("putters plan around the buildings once they're solid", () => {
    const w = solid();
    w.join("ada", { x: 12, y: 10 });
    w.join("bob", { x: 12, y: 6 });
    const steps = planPutter(w.state, "ada");
    const tiles = follow(worldGround(w.state), { x: 12, y: 10 }, steps);
    expect(tiles.some(onHall)).toBe(false);
    expect(w.send("ada", { type: "putter", steps }).ok).toBe(true);
    expect(chebyshev(w.here("ada"), { x: 12, y: 6 })).toBeLessThan(4);
  });
});
