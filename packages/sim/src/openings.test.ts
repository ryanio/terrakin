import { describe, expect, it } from "vitest";
import { apply, prepare } from "./apply";
import { designNotes } from "./design";
import { LANDS_ISLAND } from "./fixtures/lands-log";
import { hashWorld } from "./hash";
import { doorFacing, doorOutward, landlocked, openingFacts, openingsOf } from "./openings";
import { type BlockKind, type Command, TOWN_ACTOR, type WorldConfig } from "./types";
import { createWorld } from "./world";

// 7 by 7 plots of 8 tiles, so the Commons is (3, 3) and plot (1, 1) has eight neighbours that
// aren't it. Plot (1, 1) is x 8 to 15, y 8 to 15.
const CONFIG: WorldConfig = {
  width: 56,
  height: 56,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const AROUND = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
] as const;

/** Plot (1, 1) settled by "me", and the plots around it in `around` each by someone of its own. */
function town(around: readonly (readonly [number, number])[], config = CONFIG) {
  const state = createWorld(config);
  const ok = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
  };
  const settle = (actor: string, px: number, py: number) => {
    ok(actor, { type: "join", name: actor, kind: "agent" });
    ok(actor, { type: "settle", px, py });
  };
  for (const [px, py] of around) settle(`n${px}${py}`, px, py);
  /** A dry run of a build of `blocks` (plan tiles) on plot (px, py) by its owner. */
  const dry = (
    actor: string,
    px: number,
    py: number,
    blocks: { x: number; y: number; block: BlockKind }[],
  ) => {
    const before = hashWorld(state);
    const prepared = prepare(state, { actor, command: { type: "build", px, py, blocks } });
    if (!prepared.ok || !prepared.plan) throw new Error(`the plan was refused`);
    expect(hashWorld(state)).toBe(before);
    // Only the notes about ways out: a bare plot also hears it has no path.
    return designNotes(state, px, py, prepared.plan).filter(
      (n) => n.code === "no_opening" || n.code === "seals_neighbor",
    );
  };
  return { state, ok, settle, dry };
}

const at = (state: ReturnType<typeof town>["state"]) =>
  landlocked(state).map((p) => `${p.px},${p.py} ${p.why}`);

describe("openings (decision 0351)", () => {
  it("a plot walled in by claimed neighbours is landlocked, though their yards are open", () => {
    const t = town(AROUND);
    t.settle("me", 1, 1);
    // Every plot touching (1, 1) is someone's, and the world's edge is no way out either.
    expect(at(t.state)).toEqual([
      "0,0 surrounded",
      "1,0 surrounded",
      "0,1 surrounded",
      "1,1 surrounded",
    ]);
    // A plot beside a free slot steps straight out onto it.
    const facts = openingFacts(t.state);
    expect(openingsOf(facts, 2, 1, [])[0]).toEqual({ from: { x: 23, y: 8 }, to: { x: 24, y: 8 } });
  });

  it("a corner onto a free slot is a way out, and a neighbour's block beside it closes it", () => {
    const t = town(AROUND.filter(([x, y]) => !(x === 2 && y === 2)));
    t.settle("me", 1, 1);
    Object.assign(t.state.residents.me ?? {}, { x: 11, y: 11 });
    t.ok("me", { type: "set_hearth", x: 11, y: 11 });
    // The only step off (1, 1) onto ground nobody has claimed is the diagonal at its south-east
    // corner, past the corners of (2, 1) and (1, 2).
    expect(openingsOf(openingFacts(t.state), 1, 1, [{ x: 11, y: 11 }])).toEqual([
      { from: { x: 15, y: 15 }, to: { x: 16, y: 16 } },
    ]);
    expect(at(t.state).filter((p) => p.startsWith("1,1 "))).toEqual([]);
    // (2, 1)'s owner putting a wall on its south-west corner tile takes it: noted, never refused.
    const notes = t.dry("n21", 2, 1, [{ x: 0, y: 7, block: "stone" }]);
    expect(notes).toContainEqual({
      code: "seals_neighbor",
      text: "This plan closes the last way out of the plot next door, plot (1, 1): its only step onto open ground goes past the corner at (0, 7). Leave that tile open.",
      tiles: [{ x: 0, y: 7 }],
    });
    // A block one tile along leaves the corner open, and so does a door on it.
    expect(t.dry("n21", 2, 1, [{ x: 1, y: 7, block: "stone" }])).toEqual([]);
    expect(t.dry("n21", 2, 1, [{ x: 0, y: 7, block: "door" }])).toEqual([]);
    // Built, it stands: the plot is landlocked, open ground still touches it, and the notes about
    // (2, 1) say nothing more.
    t.ok("n21", { type: "build", px: 2, py: 1, blocks: [{ x: 0, y: 7, block: "stone" }] });
    expect(at(t.state)).toContain("1,1 walled");
    expect(designNotes(t.state, 2, 1).map((n) => n.code)).not.toContain("seals_neighbor");
  });

  it("notes a plan that walls the plot's own last way out", () => {
    // Free only to the north, onto (1, 0).
    const t = town(AROUND.filter(([x, y]) => !(x === 1 && y === 0)));
    t.settle("me", 1, 1);
    const wall = (door?: number) =>
      Array.from({ length: 8 }, (_, x) => ({
        x,
        y: 0,
        block: (x === door ? "door" : "stone") as BlockKind,
      }));
    expect(t.dry("me", 1, 1, wall())).toContainEqual({
      code: "no_opening",
      text: "This plan leaves the plot with no way out onto open ground: once it's built, no walk from the hearth reaches a step off the plot onto a tile nobody has claimed. The way out now is at (0, 0). Leave a gap or a door on that side.",
      tiles: [{ x: 0, y: 0 }],
    });
    // A door in the wall is a way out. The wall's west end still takes (0, 1)'s corner onto
    // (1, 0), which was its only one.
    expect(t.dry("me", 1, 1, wall(3)).map((n) => n.text)).toEqual([
      "This plan closes the last way out of the plot next door, plot (0, 1): its only step onto open ground goes past the corner at (0, 0). Leave that tile open.",
    ]);
    // A plot already landlocked hears nothing from a plan: nothing it builds takes a way out.
    const shut = town(AROUND);
    shut.settle("me", 1, 1);
    expect(shut.dry("me", 1, 1, wall())).toEqual([]);
  });

  it("works on a world with a land open: the sea is no way out, a bridge and a square are", () => {
    const t = town([], { ...CONFIG, width: 24, height: 24 });
    t.ok(TOWN_ACTOR, LANDS_ISLAND);
    // The island's four plots, all claimed: x 32 to 47, y 0 to 15, with the sea west of it but
    // for the bridge at y 11 and 12, and its square, (4, 2), south of its west column.
    for (const [px, py] of [
      [4, 0],
      [4, 1],
      [5, 0],
      [5, 1],
    ] as const) {
      t.settle(`i${px}${py}`, px, py);
    }
    // (5, 1) touches the square only at a corner, and the sea at that corner keeps the step off.
    expect(at(t.state)).toEqual(["4,0 surrounded", "5,0 surrounded", "5,1 walled"]);
    const out = openingsOf(openingFacts(t.state), 4, 1, []).map((o) => o.to);
    expect(out).toContainEqual({ x: 31, y: 11 });
    expect(out).toContainEqual({ x: 32, y: 16 });
  });
});

describe("a design's door", () => {
  it("opens out across its wall, away from the plot's middle", () => {
    // The starter hut's walls: (1, 1) to (5, 5), the doorway at (3, 5).
    const hut = (x: number, y: number) =>
      (x === 1 || x === 5 || y === 1 || y === 5) && x >= 1 && x <= 5 && y >= 1 && y <= 5;
    expect(doorOutward(8, { x: 3, y: 5 }, hut)).toBe("s");
    expect(doorOutward(8, { x: 1, y: 3 }, hut)).toBe("w");
    expect(doorOutward(8, { x: 3, y: 3 }, hut)).toBeUndefined();
  });

  it("faces open ground, or says how many quarter turns would", () => {
    // (1, 1) with (1, 2) claimed to the south and nothing else around it.
    const t = town([[1, 2]]);
    t.settle("me", 1, 1);
    const facts = openingFacts(t.state);
    expect(doorFacing(facts, 1, 1, { x: 3, y: 5 }, "s")).toEqual({ faces: false, quarters: 1 });
    expect(doorFacing(facts, 1, 1, { x: 2, y: 3 }, "w")).toEqual({ faces: true });
    // In the world's corner with its two neighbours claimed, no turn faces anything open.
    const corner = town([
      [1, 0],
      [0, 1],
    ]);
    corner.settle("me", 0, 0);
    expect(doorFacing(openingFacts(corner.state), 0, 0, { x: 3, y: 5 }, "s")).toEqual({
      faces: false,
    });
  });
});
