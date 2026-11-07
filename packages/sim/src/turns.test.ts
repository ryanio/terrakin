import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { TURNS_CONFIG, TURNS_HASH, TURNS_LOG } from "./fixtures/turns-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import { fund, stock } from "./test-support";
import { turnAt } from "./turns";
import {
  type Command,
  type Rejection,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. Ada settles plot (0, 0) and builds the starter hut: walls from (1, 1) to
// (5, 5), the doorway at (3, 5), her hearth at (3, 3), where she stands.
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
  ok("ada", { type: "join", name: "ada", kind: "human" });
  ok("ada", { type: "settle", px: 0, py: 0 });
  ok("ada", { type: "build_starter_home" });
  stock(state, "ada", { armchair: 1, rocking_chair: 1, wood: 2 });
  return { state, ok, refused };
}

describe("turning furniture", () => {
  it("sets a piece down facing the way `place` says, and keeps nothing for facing south", () => {
    const w = world();
    expect(w.ok("ada", { type: "place", x: 2, y: 2, block: "armchair", turn: 90 })).toContainEqual(
      expect.objectContaining({ type: "block_placed", x: 2, y: 2, block: "armchair", turn: 90 }),
    );
    expect(turnAt(w.state, "2,2")).toBe(90);
    const south = w.ok("ada", { type: "place", x: 4, y: 2, block: "rocking_chair", turn: 0 });
    expect(south.find((e) => e.type === "block_placed")).not.toHaveProperty("turn");
    expect(w.state.turns).toEqual({ "2,2": 90 });
  });

  it("turns a placed piece, and turned back to south keeps nothing", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "armchair" });
    expect(w.ok("ada", { type: "turn", x: 2, y: 2, turn: 180 })).toEqual([
      { type: "block_turned", x: 2, y: 2, turn: 180, by: "ada" },
    ]);
    expect(turnAt(w.state, "2,2")).toBe(180);
    expect(w.refused("ada", { type: "turn", x: 2, y: 2, turn: 180 }).code).toBe("already_there");
    w.ok("ada", { type: "turn", x: 2, y: 2, turn: 0 });
    expect(w.state.turns).toBeUndefined();
  });

  it("forgets which way a piece faced once it's taken up, so the next one there faces south", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "armchair", turn: 270 });
    w.ok("ada", { type: "remove", x: 2, y: 2 });
    expect(w.state.turns).toBeUndefined();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "rocking_chair" });
    expect(turnAt(w.state, "2,2")).toBe(0);
  });

  it("refuses to turn what isn't furniture, a turn that isn't a quarter, and an empty tile", () => {
    const w = world();
    // The hut's walls are wood, and a wall doesn't turn.
    expect(w.refused("ada", { type: "turn", x: 1, y: 1, turn: 90 }).code).toBe("not_turnable");
    expect(w.refused("ada", { type: "place", x: 2, y: 2, block: "wood", turn: 90 }).code).toBe(
      "not_turnable",
    );
    w.ok("ada", { type: "place", x: 2, y: 2, block: "armchair" });
    const quarter = { type: "turn", x: 2, y: 2, turn: 45 } as unknown as Command;
    expect(w.refused("ada", quarter).code).toBe("not_turnable");
    expect(w.refused("ada", { type: "turn", x: 4, y: 2, turn: 90 }).code).toBe("no_block");
  });

  it("forgets a turn whatever takes the piece up: a plan, or staff clearing a block", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "armchair", turn: 90 });
    w.ok("ada", { type: "place", x: 4, y: 2, block: "rocking_chair", turn: 180 });
    // A plan's removal, in plot tiles, which on plot (0, 0) are world tiles.
    w.ok("ada", { type: "build", px: 0, py: 0, remove: [{ x: 2, y: 2 }] });
    expect(w.state.turns).toEqual({ "4,2": 180 });
    w.ok(TOWN_ACTOR, { type: "clear_block", x: 4, y: 2 });
    expect(w.state.turns).toBeUndefined();
  });

  it("turns a piece upstairs on its own floor, and forgets it when it's taken up", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "open_economy" });
    fund(w.state, "ada", 500);
    w.ok("ada", { type: "add_floor", px: 0, py: 0 });
    // Flooring over the hut's north-west corner wall, and the armchair on it.
    w.ok("ada", { type: "lay", x: 1, y: 1, floor: 1, ground: "moss" });
    w.ok("ada", { type: "place", x: 1, y: 1, floor: 1, block: "armchair" });
    expect(w.ok("ada", { type: "turn", x: 1, y: 1, floor: 1, turn: 270 })).toEqual([
      { type: "block_turned", x: 1, y: 1, floor: 1, turn: 270, by: "ada" },
    ]);
    expect(turnAt(w.state, "1,1", 1)).toBe(270);
    expect(turnAt(w.state, "1,1")).toBe(0);
    expect(w.state.turns).toBeUndefined();
    w.ok("ada", { type: "remove", x: 1, y: 1, floor: 1 });
    expect(w.state.floors?.["1"]?.turns).toBeUndefined();
  });

  it("refuses a turn on a wall between tiles rather than dropping it", () => {
    const w = world();
    expect(
      w.refused("ada", { type: "place", x: 2, y: 2, side: "n", block: "wood", turn: 90 }).code,
    ).toBe("not_turnable");
  });

  it("is only for whoever builds on the plot", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "armchair" });
    w.ok("bob", { type: "join", name: "bob", kind: "human" });
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("no bob");
    // In the doorway, with the armchair in reach.
    bob.x = 3;
    bob.y = 5;
    expect(w.refused("bob", { type: "turn", x: 2, y: 2, turn: 90 }).code).toBe("not_your_plot");
  });

  it("replays the turns fixture to its pinned hash", () => {
    expect(hashWorld(replay(TURNS_CONFIG, TURNS_LOG))).toBe(TURNS_HASH);
  });
});
