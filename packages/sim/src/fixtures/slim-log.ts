import type { Input, PlanEdge } from "../types";
import { TOWN_ACTOR } from "../types";

/**
 * Two residents slim their starter huts of wall blocks themselves (RFC 0050), each `slim_walls`
 * the plan the server's `slimPlan` made. `edges.test.ts` replays it and checks the hash pinned
 * below, the hash the sim gave before a slim checked its lines first (decision 0404), so a change
 * to how a resident's slim replays fails loudly.
 */
export const SLIM_CONFIG = { width: 24, height: 24, plotSize: 8, maxPlotsPerResident: 1, reach: 3 };

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

/** The starter hut's slim, in plot coordinates: its 16 blocks up, 20 lines round 25 tiles. */
const HUT = {
  remove: (
    [
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [1, 3],
      [4, 1],
      [5, 1],
      [5, 2],
      [5, 3],
      [1, 4],
      [5, 4],
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ] as const
  ).map(([x, y]) => ({ x, y })),
  edges: [
    { x: 1, y: 1, side: "n", block: "wood" },
    { x: 1, y: 1, side: "w", block: "wood" },
    { x: 2, y: 1, side: "n", block: "wood" },
    { x: 3, y: 1, side: "n", block: "wood" },
    { x: 1, y: 2, side: "w", block: "wood" },
    { x: 1, y: 3, side: "w", block: "glass" },
    { x: 4, y: 1, side: "n", block: "wood" },
    { x: 5, y: 1, side: "n", block: "wood" },
    { x: 5, y: 1, side: "e", block: "wood" },
    { x: 5, y: 2, side: "e", block: "wood" },
    { x: 5, y: 3, side: "e", block: "glass" },
    { x: 1, y: 4, side: "w", block: "wood" },
    { x: 5, y: 4, side: "e", block: "wood" },
    { x: 1, y: 5, side: "s", block: "wood" },
    { x: 1, y: 5, side: "w", block: "wood" },
    { x: 2, y: 5, side: "s", block: "wood" },
    { x: 3, y: 5, side: "s", block: "door" },
    { x: 4, y: 5, side: "s", block: "wood" },
    { x: 5, y: 5, side: "e", block: "wood" },
    { x: 5, y: 5, side: "s", block: "wood" },
  ] satisfies PlanEdge[],
};

export const SLIM_LOG: Input[] = [
  town({ type: "new_day", day: 20_000 }),
  town({ type: "starter_doors" }),
  { actor: "ada", command: { type: "join", name: "ada", kind: "human" } },
  { actor: "ada", command: { type: "settle", px: 0, py: 0 } },
  { actor: "ada", command: { type: "build_starter_home" } },
  { actor: "bob", command: { type: "join", name: "bob", kind: "human" } },
  { actor: "bob", command: { type: "settle", px: 1, py: 0 } },
  { actor: "bob", command: { type: "build_starter_home" } },
  { actor: "ada", command: { type: "slim_walls", px: 0, py: 0, ...HUT } },
  { actor: "bob", command: { type: "slim_walls", px: 1, py: 0, ...HUT } },
];

/** `hashWorld(replay(SLIM_CONFIG, SLIM_LOG))`, pinned so a change to how it replays fails. */
export const SLIM_HASH = "d9b31c1e";
