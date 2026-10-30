import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { EDGES_CONFIG, EDGES_LOG } from "./edges-log";

/**
 * The walls-between-tiles world with the town's slim (RFC 0050, decision 0404). Dee's hut of wall
 * blocks on plot (1, 0), built before `starter_edges`, has a block upstairs on its west window with
 * no flooring under it. The town logs her slim as `town_slim`, the plan the server's `slimPlan`
 * made, which takes that block down too, then `slim_homes`. `edges.test.ts` replays it and checks
 * the hash pinned below.
 */
export const SLIM_HOMES_CONFIG = EDGES_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

const tiles = (list: [number, number][]) => list.map(([x, y]) => ({ x, y }));

export const SLIM_HOMES_LOG: Input[] = [
  ...EDGES_LOG,
  town({
    type: "town_slim",
    px: 1,
    py: 0,
    remove: [
      ...tiles([
        [1, 1],
        [2, 1],
        [3, 1],
        [1, 2],
        [1, 3],
      ]),
      { x: 1, y: 3, floor: 1 },
      ...tiles([
        [4, 1],
        [5, 1],
        [5, 2],
        [5, 3],
        [1, 4],
        [5, 4],
        [1, 5],
        [2, 5],
        [4, 5],
        [5, 5],
      ]),
    ],
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
      { x: 4, y: 5, side: "s", block: "wood" },
      { x: 5, y: 5, side: "e", block: "wood" },
      { x: 5, y: 5, side: "s", block: "wood" },
      { x: 3, y: 5, side: "s", block: "door" },
    ],
  }),
  town({ type: "slim_homes" }),
];

/** `hashWorld(replay(SLIM_HOMES_CONFIG, SLIM_HOMES_LOG))`, pinned so a change to how it replays fails. */
export const SLIM_HOMES_HASH = "9bc49182";
