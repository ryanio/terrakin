import {
  apply,
  createWorld,
  edgeKey,
  TOWN_ACTOR,
  tileKey,
  type WorldConfig,
  worldGround,
} from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { slimPlan } from "./slim-plan";

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/**
 * Ada on plot (0, 0) with the starter hut of wall blocks: (1, 1) to (5, 5), glass at the sides,
 * and a door at (3, 5), or the open doorway huts had before decision 0349 with `doors` false.
 */
function hut(doors = true) {
  const state = createWorld(CONFIG);
  const ok = (actor: string, command: Parameters<typeof apply>[1]["command"]) =>
    expect(apply(state, { actor, command })).toMatchObject({ ok: true });
  ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  if (doors) ok(TOWN_ACTOR, { type: "starter_doors" });
  ok("ada", { type: "join", name: "ada", kind: "human" });
  ok("ada", { type: "settle", px: 0, py: 0 });
  ok("ada", { type: "build_starter_home" });
  return { state, ok };
}

describe("slimPlan", () => {
  it("takes up the hut's 16 blocks and walls its 25 tiles in with 20 lines, door and windows kept", () => {
    const { state } = hut();
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.remove).toHaveLength(16);
    expect(plan.edges).toHaveLength(20);
    const kinds = plan.edges.map((e) => e.block);
    expect(kinds.filter((k) => k === "door")).toHaveLength(1);
    expect(kinds.filter((k) => k === "glass")).toHaveLength(2);
    // The door stays on the south side's middle: the line south of (3, 5).
    const door = plan.edges.find((e) => e.block === "door");
    expect(door && edgeKey(door.x, door.y, door.side)).toBe(edgeKey(3, 6, "n"));
  });

  it("is logged as the resident's own slim, which the sim builds whole", () => {
    const { state, ok } = hut();
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    expect(state.blocks).toEqual({});
    expect(Object.keys(state.edges ?? {})).toHaveLength(20);
    // Slimmed already: nothing walled in by blocks is left.
    expect(slimPlan(state, 0, 0)).toHaveProperty("problem");
  });

  it("slims a hut built before doors, its open doorway becoming a door", () => {
    const { state, ok } = hut(false);
    expect(state.blocks["3,5"]).toBeUndefined();
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.remove).toHaveLength(15);
    expect(plan.edges).toHaveLength(20);
    const doors = plan.edges.filter((e) => e.block === "door");
    expect(doors.map((e) => edgeKey(e.x, e.y, e.side))).toEqual([edgeKey(3, 6, "n")]);
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    expect(state.blocks).toEqual({});
  });

  it("keeps an inner wall as lines between the rooms, its door a door", () => {
    // Ada's own home of blocks: wood from (1, 1) to (6, 6), the door at (2, 6), and an inner wall
    // down x = 4 with a door at (4, 3). The west room is x 2 to 3, the east room x = 5.
    const { state, ok } = hut();
    state.blocks = {};
    for (let i = 1; i <= 6; i++) {
      for (const [x, y] of [
        [i, 1],
        [i, 6],
        [1, i],
        [6, i],
      ] as const) {
        state.blocks[tileKey(x, y)] = "wood";
      }
    }
    state.blocks[tileKey(2, 6)] = "door";
    for (let y = 2; y <= 5; y++) state.blocks[tileKey(4, y)] = y === 3 ? "door" : "wood";
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.remove).toHaveLength(24);
    const lines = new Map(plan.edges.map((e) => [edgeKey(e.x, e.y, e.side), e.block]));
    // 24 round the outside, and the inner wall's line from top to bottom: x = 4's west side.
    expect(lines.size).toBe(30);
    for (let y = 1; y <= 6; y++) {
      expect(lines.get(edgeKey(4, y, "w"))).toBe(y === 3 ? "door" : "wood");
    }
    expect(lines.get(edgeKey(2, 7, "n"))).toBe("door");
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    // The two rooms stay apart: a step across the inner wall's line is a wall, but for its door.
    const ground = worldGround(state);
    expect(ground.edge?.(3, 2, "e")).toBe(true);
    expect(ground.edge?.(3, 3, "e")).toBe(false);
  });
});
