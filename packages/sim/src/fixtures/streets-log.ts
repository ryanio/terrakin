import type { Command, Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PRESENCE_CONFIG, PRESENCE_LOG } from "./presence-log";

/**
 * The presence world once a land with streets opens ([RFC 0046](../../../../docs/rfcs/0046-streets.md)).
 * Downtown is 3 by 3 plots of 8 tiles; this adds one plot-width of water east of it and a small
 * long cross beyond: the square at (5, 1) where its streets cross, a street on each side of it,
 * and a plot in each corner. The square touches only streets, which is the square rule's one
 * change. Every plot is claimed, and then Isla walks from her plot to the island's counter and on
 * to the bridge without setting foot on anyone else's plot. `streets.test.ts` replays it and
 * checks the hash pinned below.
 */
export const STREETS_CONFIG = PRESENCE_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const isla = (command: Input["command"]): Input => ({ actor: "isla", command });

/** The island as the town opens it: x 32 to 55, the bridge along y 11 and 12 from x 24 to 31. */
export const STREETS_ISLAND: Extract<Command, { type: "open_land" }> = {
  type: "open_land",
  land: "willowmere",
  name: "Willowmere",
  width: 56,
  height: 24,
  plots: [
    [4, 0],
    [4, 2],
    [6, 0],
    [6, 2],
  ],
  streets: [
    [4, 1],
    [5, 0],
    [5, 2],
    [6, 1],
  ],
  square: [5, 1],
  bridge: [
    [24, 11],
    [24, 12],
    [25, 11],
    [25, 12],
    [26, 11],
    [26, 12],
    [27, 11],
    [27, 12],
    [28, 11],
    [28, 12],
    [29, 11],
    [29, 12],
    [30, 11],
    [30, 12],
    [31, 11],
    [31, 12],
  ],
};

export const STREETS_LOG: Input[] = [
  ...PRESENCE_LOG,
  town(STREETS_ISLAND),
  // Every plot on the island is claimed, so the walk below crosses no yard because there is none
  // to cross, not because a neighbor left theirs open.
  isla({ type: "join", name: "isla", kind: "agent" }),
  isla({ type: "settle", px: 4, py: 0 }),
  { actor: "jo", command: { type: "join", name: "jo", kind: "agent" } },
  { actor: "jo", command: { type: "settle", px: 6, py: 0 } },
  { actor: "kit", command: { type: "join", name: "kit", kind: "agent" } },
  { actor: "kit", command: { type: "settle", px: 4, py: 2 } },
  { actor: "lu", command: { type: "join", name: "lu", kind: "agent" } },
  { actor: "lu", command: { type: "settle", px: 6, py: 2 } },
  // From her plot, south onto the west street and across the square to the counter, (44, 14).
  isla({ type: "move", dir: "s" }),
  isla({ type: "move", dir: "s" }),
  isla({ type: "move", dir: "se" }),
  isla({ type: "move", dir: "se" }),
  isla({ type: "move", dir: "se" }),
  isla({ type: "move", dir: "se" }),
  isla({ type: "move", dir: "se" }),
  isla({ type: "move", dir: "se" }),
  // And west along the street to the bridge's island end, (31, 11).
  isla({ type: "move", dir: "w" }),
  isla({ type: "move", dir: "w" }),
  isla({ type: "move", dir: "w" }),
  isla({ type: "move", dir: "w" }),
  isla({ type: "move", dir: "w" }),
  isla({ type: "move", dir: "w" }),
  isla({ type: "move", dir: "w" }),
  isla({ type: "move", dir: "w" }),
  isla({ type: "move", dir: "w" }),
  isla({ type: "move", dir: "w" }),
];

/** Pinned in `streets.test.ts` when streets landed. */
export const STREETS_HASH = "9f543bcf";
