import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PLOT_BUILDING_CONFIG, PLOT_BUILDING_LOG } from "./plot-building-log";

/**
 * The plot-building world regridded (RFC 0052). Ada's starter hut, her bench in the far corner and
 * her wall on a line move to the middle of her 16-tile slot. She puts a planter in her lot after
 * it, takes a step east, and lays a path by her door. `regrid.test.ts` replays it to the hash pinned
 * below, and `replay.test.ts` checks every split point, so a change to how a world moves fails.
 */
export const REGRID_CONFIG = PLOT_BUILDING_CONFIG;

const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

export const REGRID_LOG: Input[] = [
  ...PLOT_BUILDING_LOG,
  { actor: TOWN_ACTOR, command: { type: "regrid" } },
  ada({ type: "place", x: 6, y: 6, block: "planter" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "lay", x: 7, y: 10, ground: "dirt" }),
];

/** `hashWorld(replay(REGRID_CONFIG, REGRID_LOG))`, pinned so a change to how it replays fails. */
export const REGRID_HASH = "bbd7de51";
