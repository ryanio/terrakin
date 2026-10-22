import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { nearestCounter } from "./doors";
import {
  STREETS_ISLAND as ISLAND,
  STREETS_CONFIG,
  STREETS_HASH,
  STREETS_LOG,
} from "./fixtures/streets-log";
import { hashWorld } from "./hash";
import { plotKey } from "./keys";
import { isSea, isStreet, landPlots, onLand, plotsLeft } from "./lands";
import { landlocked, nearestFreePlot } from "./openings";
import { replay } from "./replay";
import type { Command, Input, WorldState } from "./types";
import { TOWN_ACTOR } from "./types";
import { counterDoor, landSquare, plotOf } from "./world";

/**
 * Streets on new lands (RFC 0046). The fixture opens a small long cross east of a 3 by 3
 * downtown: the square at (5, 1) where the streets cross, a street on each side of it, and a plot
 * in each corner.
 */

/** The world the fixture opens its island in, with the island not yet open. */
const beforeIsland = (): WorldState =>
  replay(
    STREETS_CONFIG,
    STREETS_LOG.slice(0, STREETS_LOG.indexOf(STREETS_LOG.find(isOpenLand) as Input)),
  );

function isOpenLand(input: Input): boolean {
  return input.command.type === "open_land";
}

/** The world just after the island opened, with Isla joined and nobody on the island yet. */
function opened(): WorldState {
  const state = beforeIsland();
  for (const input of [
    { actor: TOWN_ACTOR, command: ISLAND },
    { actor: "isla", command: { type: "join", name: "isla", kind: "agent" } },
  ] satisfies Input[]) {
    const result = apply(state, input);
    if (!result.ok) throw new Error(result.rejection.message);
  }
  return state;
}

/** Send a command and return its refusal, checking a refusal changed nothing. */
function refusal(state: WorldState, actor: string, command: Command) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  if (result.ok) return undefined;
  expect(hashWorld(state), "a refusal changed the world").toBe(before);
  return result.rejection;
}

describe("a land with streets", () => {
  it("replays, and the walk from a plot to the counter and the bridge crosses no one's yard", () => {
    const state = replay(STREETS_CONFIG, STREETS_LOG.slice(0, -18));
    const counter = counterDoor(state.config, landSquare(state.config, 5, 1));
    const walk = STREETS_LOG.slice(-18);
    const near = (t: { x: number; y: number }) =>
      Math.max(Math.abs(t.x - counter.x), Math.abs(t.y - counter.y)) <= state.config.reach;
    let reachedCounter = false;
    for (const input of walk) {
      const result = apply(state, input);
      expect(result.ok).toBe(true);
      const isla = state.residents.isla;
      if (!isla) throw new Error("isla isn't here");
      const { px, py } = plotOf(state.config, isla.x, isla.y);
      const owner = state.plots[plotKey(px, py)]?.ownerId;
      expect(
        owner === undefined || owner === "isla",
        `on ${owner}'s plot at ${isla.x},${isla.y}`,
      ).toBe(true);
      reachedCounter ||= near(isla);
    }
    expect(reachedCounter).toBe(true);
    expect(state.residents.isla).toMatchObject({ x: 31, y: 11 });
    expect(hashWorld(state)).toBe(STREETS_HASH);
    // Fully claimed, no plot on the island is closed in: each has a side on a street.
    expect(landlocked(state).filter((p) => p.px >= 4)).toEqual([]);
  });

  it("is land, never a plot to claim, and the opening says so on the wire", () => {
    const state = beforeIsland();
    const result = apply(state, { actor: TOWN_ACTOR, command: ISLAND });
    expect(result.ok && result.events).toEqual([{ ...ISLAND, type: "land_opened" }]);
    const left = plotsLeft(state);
    for (const [px, py] of ISLAND.streets ?? []) {
      expect(isStreet(state, px, py)).toBe(true);
      expect(onLand(state, px, py)).toBe(true);
      expect(isSea(state, px * 8 + 3, py * 8 + 3)).toBe(false);
      expect(landPlots(state).some((p) => p.x === px && p.y === py)).toBe(false);
    }
    // Only the four corner plots joined the count.
    expect(left).toBe(plotsLeft(beforeIsland()) + 4);
  });

  it.each<[string, Partial<Extract<Command, { type: "open_land" }>>]>([
    ["a street outside the world the land makes", { streets: [[9, 0]] }],
    ["a street already downtown", { streets: [[1, 1]] }],
    ["a street that is one of the land's plots", { streets: [[4, 0]] }],
    [
      "streets out of order",
      {
        streets: [
          [6, 1],
          [4, 1],
        ],
      },
    ],
    ["an empty list of streets", { streets: [] }],
    ["a square on a street", { square: [4, 1] }],
    ["a bridge tile on a street", { bridge: [[32, 11]] }],
  ])("refuses %s", (_, change) => {
    const state = beforeIsland();
    expect(refusal(state, TOWN_ACTOR, { ...ISLAND, ...change })?.code).toBe("server_only");
    expect(state.lands).toBeUndefined();
  });

  it("refuses a square with no plot or street beside it", () => {
    // Without its streets, the square where they cross touches nothing of its own land.
    const state = beforeIsland();
    const { streets, ...bare } = ISLAND;
    expect(streets).toBeDefined();
    expect(refusal(state, TOWN_ACTOR, bare)?.code).toBe("server_only");
    expect(state.lands).toBeUndefined();
  });
});

describe("settling on a street", () => {
  it.each(ISLAND.streets ?? [])("refuses %i,%i with the nearest free plot named", (px, py) => {
    const state = opened();
    const settled = refusal(state, "isla", { type: "settle", px, py });
    expect(settled?.code).toBe("public_ground");
    expect(settled?.message).toContain("Willowmere's streets");
    const named = settled?.message.match(/settle at px (\d+), py (\d+)/);
    expect(named, settled?.message).not.toBeNull();
    expect(isStreet(state, Number(named?.[1]), Number(named?.[2]))).toBe(false);
    // Claiming it from where you stand is refused the same way.
    const isla = state.residents.isla;
    if (!isla) throw new Error("isla isn't here");
    isla.x = px * 8 + 3;
    isla.y = py * 8 + 3;
    const claimed = refusal(state, "isla", { type: "claim" });
    expect(claimed?.code).toBe("public_ground");
    expect(claimed?.message).toContain("Willowmere's streets");
  });

  it("never names a street as the nearest free plot", () => {
    const state = opened();
    // From the square and from each street, the nearest free plot is one of the corner plots.
    for (const [px, py] of [ISLAND.square, ...(ISLAND.streets ?? [])]) {
      const free = nearestFreePlot(state, px, py);
      expect(free && isStreet(state, free.px, free.py)).toBe(false);
      expect(free && free.px >= 4).toBe(true);
    }
  });

  it("sends someone on a street to the island's counter", () => {
    const state = opened();
    const counter = counterDoor(state.config, landSquare(state.config, 5, 1));
    for (const [px, py] of ISLAND.streets ?? []) {
      expect(nearestCounter(state, { x: px * 8 + 3, y: py * 8 + 3 })).toEqual(counter);
    }
  });

  it.each<[string, Command]>([
    ["a block", { type: "place", x: 35, y: 12, block: "wood" }],
    ["a path", { type: "lay", x: 35, y: 12, ground: "dirt" }],
    ["a plan", { type: "build", px: 4, py: 1, blocks: [{ x: 3, y: 4, block: "wood" }] }],
  ])("refuses %s on a street, which is everyone's ground", (_, command) => {
    const state = opened();
    const isla = state.residents.isla;
    if (!isla) throw new Error("isla isn't here");
    isla.x = 35;
    isla.y = 11;
    const refused = refusal(state, "isla", command);
    expect(refused?.code).toBe("public_ground");
    expect(refused?.message).toContain("Willowmere's streets");
  });
});
