import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { designNotes } from "./design";
import { COZY_CONFIG, COZY_HASH, COZY_LOG } from "./fixtures/cozy-log";
import { postureOn, SEATS, WALKED_ONTO_SEATS } from "./furniture";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import { stock } from "./test-support";
import {
  BLOCK_KINDS,
  type Command,
  type Rejection,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
import { blocksWalkers, createWorld } from "./world";

// 3x3 plots of 8 tiles. Ada settles plot (0, 0) and builds the starter hut: walls from (1, 1) to
// (5, 5), the doorway at (3, 5), her hearth at (3, 3), where she stands. Bob settles plot (2, 0)
// and stands at (19, 3).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** A world where every refusal is checked to leave the state byte-identical. */
function world() {
  const state = createWorld(CONFIG);
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const refused = (actor: string, command: Command): Rejection => {
    const result = send(actor, command);
    expect(result.ok, `${actor} ${JSON.stringify(command)} should be refused`).toBe(false);
    return result.ok ? { code: "internal" as never, message: "" } : result.rejection;
  };
  ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  ok(TOWN_ACTOR, { type: "open_items" });
  for (const [name, px] of [
    ["ada", 0],
    ["bob", 2],
  ] as const) {
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py: 0 });
  }
  ok("ada", { type: "build_starter_home" });
  stock(state, "ada", { armchair: 1, sofa: 1, bed: 1, chair: 1, table: 1 });
  const at = (id: string) => {
    const r = state.residents[id];
    return { x: r?.x, y: r?.y };
  };
  return { state, ok, refused, at };
}

describe("seats", () => {
  it("are the six pieces you rest on, and only the armchair, sofa and bed are walked onto", () => {
    expect(SEATS).toEqual({
      chair: "sit",
      bench: "sit",
      armchair: "sit",
      sofa: "sit",
      bed: "lie",
      rocking_chair: "sit",
    });
    // Every block kind but stairs, a door, and the walked-onto seats is in the way.
    const walkedOnto = BLOCK_KINDS.filter((k) => !blocksWalkers(k));
    expect(walkedOnto).toEqual(["stairs", "door", ...WALKED_ONTO_SEATS]);
    expect([postureOn("bed"), postureOn("bench"), postureOn("table")]).toEqual([
      "lie",
      "sit",
      undefined,
    ]);
  });

  it("leave the hearth reachable with a sofa between it and the doorway, where a chair shuts it in", () => {
    const w = world();
    w.ok("ada", { type: "move", dir: "n" });
    w.ok("ada", { type: "place", x: 3, y: 4, block: "chair" });
    expect(designNotes(w.state, 0, 0).map((n) => n.code)).toContain("hearth_walled_in");
    w.ok("ada", { type: "remove", x: 3, y: 4 });
    w.ok("ada", { type: "place", x: 3, y: 4, block: "sofa" });
    expect(designNotes(w.state, 0, 0).map((n) => n.code)).not.toContain("hearth_walled_in");
    // And she walks out over it: hearth, sofa, doorway, outside.
    w.ok("ada", { type: "move", dir: "s" });
    for (const dir of ["s", "s", "s"] as const) w.ok("ada", { type: "move", dir });
    expect(w.at("ada")).toEqual({ x: 3, y: 6 });
  });
});

describe("rest", () => {
  it("puts you on a seat one step away, and any step takes you off", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "bed" });
    // From the hearth at (3, 3), the bed is a diagonal step away with both corners open.
    expect(w.ok("ada", { type: "rest", x: 2, y: 2 })).toEqual([
      { type: "moved", residentId: "ada", x: 2, y: 2 },
      { type: "rested", residentId: "ada", x: 2, y: 2, block: "bed" },
    ]);
    expect(w.state.blocks["2,2"]).toBe("bed");
    expect(w.refused("ada", { type: "rest", x: 2, y: 2 }).code).toBe("already_there");
    w.ok("ada", { type: "move", dir: "e" });
    expect(w.at("ada")).toEqual({ x: 3, y: 2 });
  });

  it("rests on a chair, which stays in the way of a step", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 4, y: 3, block: "chair" });
    expect(w.refused("ada", { type: "move", dir: "e" }).code).toBe("blocked");
    w.ok("ada", { type: "rest", x: 4, y: 3 });
    expect(w.at("ada")).toEqual({ x: 4, y: 3 });
    // Off it again, as from any tile.
    w.ok("ada", { type: "move", dir: "n" });
    expect(w.at("ada")).toEqual({ x: 4, y: 2 });
  });

  it("can't cut the corner of a wall or anything else in the way", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "armchair" });
    w.ok("ada", { type: "place", x: 3, y: 2, block: "table" });
    const corner = w.refused("ada", { type: "rest", x: 2, y: 2 });
    expect(corner.code).toBe("out_of_reach");
    expect(corner.message).toContain("Walk there: move");
  });

  it("refuses what isn't a seat, a seat too far, and one someone's on", () => {
    const w = world();
    expect(w.refused("ada", { type: "rest", x: 2, y: 3 }).code).toBe("no_block");
    expect(w.refused("ada", { type: "rest", x: 1, y: 3 }).code).toBe("not_a_seat");
    expect(w.refused("ada", { type: "rest", x: 99, y: 3 }).code).toBe("out_of_bounds");
    expect(w.refused("ada", { type: "rest", x: 2.5, y: 3 }).code).toBe("out_of_bounds");
    w.ok("ada", { type: "place", x: 4, y: 4, block: "sofa" });
    // Upstairs is another floor, which she isn't on.
    expect(w.refused("ada", { type: "rest", x: 4, y: 4, floor: 1 }).code).toBe("out_of_reach");
    // Bob, across the town, is told the walk.
    const far = w.refused("bob", { type: "rest", x: 4, y: 4 });
    expect(far.code).toBe("out_of_reach");
    expect(far.message).toContain("Walk there:");
    // Bob walks over and in; Ada takes the sofa first.
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("no bob");
    bob.x = 3;
    bob.y = 4;
    w.ok("ada", { type: "rest", x: 4, y: 4 });
    expect(w.refused("bob", { type: "rest", x: 4, y: 4 }).code).toBe("tile_occupied");
  });

  it("leaves you standing when the seat is taken up from under you", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 4, y: 3, block: "armchair" });
    w.ok("ada", { type: "rest", x: 4, y: 3 });
    w.ok("ada", { type: "remove", x: 4, y: 3 });
    expect(w.at("ada")).toEqual({ x: 4, y: 3 });
    expect(w.state.blocks["4,3"]).toBeUndefined();
  });

  it("is made at a workbench from wood and cushions", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "workbench" });
    stock(w.state, "ada", { wood: 2, cushion: 1 });
    w.ok("ada", { type: "craft", recipe: "armchair", x: 2, y: 2 });
    expect(w.state.items?.inventories.ada?.stacks.armchair).toBe(2);
    expect(w.state.items?.inventories.ada?.stacks.cushion).toBeUndefined();
  });

  it("replays the cozy log to its pinned hash", () => {
    expect(hashWorld(replay(COZY_CONFIG, COZY_LOG))).toBe(COZY_HASH);
  });
});
