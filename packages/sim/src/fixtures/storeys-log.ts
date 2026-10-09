import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { BUILD_CONFIG, BUILD_LOG } from "./build-log";

/**
 * The build world after homes get storeys (RFC 0028). Dee, offline in her hut on plot (1, 0),
 * is given coins and comes back by adding a storey from her hearth, lays a moss loft over the middle of her hut,
 * puts a hedge on it and a window on a wall, takes the hedge away, and lifts one tile of moss.
 * Then she puts up stairs, climbs them, walks and putters about the loft, stands over her hearth
 * upstairs on a new day without its allowance, jumps home for it, and goes up and down again.
 * `storeys.test.ts` replays it and checks the hash pinned below, so a change to how a storey is
 * added, held up, or built on that would replay a real log differently fails loudly. Every older
 * fixture hashes as before.
 */
export const STOREYS_CONFIG = BUILD_CONFIG;

const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const STOREYS_LOG: Input[] = [
  ...BUILD_LOG,
  // A storey costs more than Dee has saved, so the town tops her purse up.
  town({ type: "test_grant", to: "dee", coins: 100 }),
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
  // Stairs from the wood the town hands her, and a floor beside where they come up.
  town({ type: "test_grant", to: "dee", stacks: { wood: 4 } }),
  dee({ type: "place", x: 12, y: 4, block: "stairs" }),
  dee({ type: "lay", x: 12, y: 3, storey: 1, ground: "moss" }),
  // Onto the stairs, up them, and about the loft.
  dee({ type: "move", dir: "e" }),
  dee({ type: "move", dir: "s" }),
  dee({ type: "move", dir: "up" }),
  dee({ type: "move", dir: "n" }),
  dee({ type: "putter", steps: ["w", "e"] }),
  // A new day: over her hearth upstairs is no allowance; home jumps down to it, and pays.
  town({ type: "new_day", day: 20021 }),
  dee({ type: "move", dir: "w" }),
  dee({ type: "home" }),
  // Up again and back down.
  dee({ type: "move", dir: "e" }),
  dee({ type: "move", dir: "s" }),
  dee({ type: "move", dir: "up" }),
  dee({ type: "move", dir: "down" }),
];

/** `hashWorld(replay(STOREYS_CONFIG, STOREYS_LOG))`, pinned when storeys landed in the sim. */
export const STOREYS_HASH = "0ec80c95";
