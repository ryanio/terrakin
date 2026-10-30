import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { furnishing, furnishings } from "./furnished";
import { plotKey, tileKey } from "./keys";
import { stock } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldConfig } from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. Ada settles plot (0, 0) and builds the starter hut: walls from (1, 1) to
// (5, 5), glass at (1, 3) and (5, 3), the doorway at (3, 5), her hearth at (3, 3), where she
// stands. Bob settles plot (2, 0) and builds nothing.
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const NONE = { pieces: 0, onSurfaces: 0, onWalls: 0, onDisplay: 0, kinds: 0 };

function world() {
  const state = createWorld(CONFIG);
  const ok = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
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
  return { state, ok };
}

describe("furnishing (RFC 0050)", () => {
  it("is nothing for a bare hut, an empty plot, and a world without items", () => {
    const w = world();
    expect(furnishing(w.state, 0, 0)).toEqual(NONE);
    expect(furnishing(w.state, 2, 0)).toEqual(NONE);
    expect(furnishing(createWorld(CONFIG), 0, 0)).toEqual(NONE);
    expect(furnishings(w.state).size).toBe(0);
  });

  it("counts furniture and seats on every floor, what's on show, and the kinds among them", () => {
    const w = world();
    stock(w.state, "ada", {
      table: 1,
      chair: 2,
      desk: 1,
      bench: 1,
      lantern: 1,
      candle: 1,
      wall_clock: 1,
      seashell: 1,
    });
    // Inside the hut: a table with a candle on it, two chairs, a desk, and a clock on the east wall.
    w.ok("ada", { type: "place", x: 2, y: 2, block: "table" });
    w.ok("ada", { type: "put_on", x: 2, y: 2, item: "candle" });
    w.ok("ada", { type: "place", x: 4, y: 2, block: "chair" });
    w.ok("ada", { type: "place", x: 4, y: 3, block: "chair" });
    w.ok("ada", { type: "place", x: 2, y: 4, block: "desk" });
    w.ok("ada", { type: "hang", x: 4, y: 4, side: "e", item: "wall_clock" });
    // In the yard: a bench (a seat, so a piece), a lantern (decor, so not), and a seashell on a
    // pedestal (on show; the pedestal itself is not a piece).
    w.ok("ada", { type: "place", x: 6, y: 1, block: "bench" });
    w.ok("ada", { type: "place", x: 0, y: 6, block: "lantern" });
    w.ok("ada", { type: "place", x: 6, y: 6, block: "pedestal" });
    w.ok("ada", { type: "display", item: "seashell", x: 6, y: 6 });
    // A bed upstairs. Setup only: the floors suite proves how one gets there.
    w.state.floors = { "1": { blocks: { [tileKey(3, 3)]: "bed" }, ground: {} } };

    const ada = furnishing(w.state, 0, 0);
    expect(ada).toEqual({
      pieces: 6,
      onSurfaces: 1,
      onWalls: 1,
      onDisplay: 1,
      // table, chair, desk, bench, bed, candle, wall clock, seashell
      kinds: 8,
    });
    // Bob's plot next door counts none of it, and the one pass over the world agrees with the
    // single plot's read.
    expect(furnishing(w.state, 2, 0)).toEqual(NONE);
    expect([...furnishings(w.state)]).toEqual([[plotKey(0, 0), ada]]);
  });
});
