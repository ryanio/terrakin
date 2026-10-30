import { apply, createWorld, edgeKey, TOWN_ACTOR, type WorldConfig } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { slimPlan } from "./slim-plan";

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** Ada on plot (0, 0) with the starter hut of wall blocks: (1, 1) to (5, 5), glass at the sides. */
function hut() {
  const state = createWorld(CONFIG);
  const ok = (actor: string, command: Parameters<typeof apply>[1]["command"]) =>
    expect(apply(state, { actor, command })).toMatchObject({ ok: true });
  ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  ok(TOWN_ACTOR, { type: "starter_doors" });
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
});
