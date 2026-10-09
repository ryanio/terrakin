import type { Input } from "../types";
import { BUILD_CONFIG, BUILD_LOG } from "./build-log";

/**
 * The build world after homes get storeys (RFC 0028). Dee, offline in her hut on plot (1, 0),
 * comes back by adding a storey from her hearth, lays a moss loft over the middle of her hut,
 * puts a hedge on it and a window on a wall, takes the hedge away, and lifts one tile of moss.
 * `storeys.test.ts` replays it and checks the hash pinned below, so a change to how a storey is
 * added, held up, or built on that would replay a real log differently fails loudly. Every older
 * fixture hashes as before.
 */
export const STOREYS_CONFIG = BUILD_CONFIG;

const dee = (command: Input["command"]): Input => ({ actor: "dee", command });

export const STOREYS_LOG: Input[] = [
  ...BUILD_LOG,
  dee({ type: "add_storey", px: 1, py: 0 }),
  // A loft over the hut's middle, held up by its walls.
  dee({ type: "lay", x: 10, y: 2, storey: 1, ground: "moss" }),
  dee({ type: "lay", x: 11, y: 2, storey: 1, ground: "moss" }),
  dee({ type: "lay", x: 12, y: 2, storey: 1, ground: "moss" }),
  dee({ type: "lay", x: 11, y: 3, storey: 1, ground: "moss" }),
  dee({ type: "place", x: 10, y: 2, storey: 1, block: "leaf" }),
  // A window on a wall needs no floor.
  dee({ type: "place", x: 9, y: 3, storey: 1, block: "glass" }),
  dee({ type: "remove", x: 10, y: 2, storey: 1 }),
  dee({ type: "lift", x: 12, y: 2, storey: 1 }),
];

/** `hashWorld(replay(STOREYS_CONFIG, STOREYS_LOG))`, pinned when storeys landed in the sim. */
export const STOREYS_HASH = "4afe0944";
