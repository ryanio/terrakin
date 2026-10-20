import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PRESENCE_CONFIG, PRESENCE_LOG } from "./presence-log";

/**
 * The presence world once a land opens beyond the first grid ([RFC 0038](../../../../docs/rfcs/0038-new-lands.md)).
 * Downtown is 3 by 3 plots of 8 tiles; this adds one plot-width of water east of it and a 2 by 2
 * island beyond, bridged along the Commons' latitude, then walks a resident over the bridge and
 * settles them there. `lands.test.ts` replays it and checks the hash pinned below, so a change to
 * how a land opens, where the water is, or what the bridge reaches fails loudly. Every older
 * fixture has no land at all, so it hashes as it did.
 */
export const LANDS_CONFIG = PRESENCE_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

export const LANDS_LOG: Input[] = [
  ...PRESENCE_LOG,
  town({
    type: "open_land",
    land: "willowmere",
    name: "Willowmere",
    width: 48,
    height: 24,
    plots: [
      [4, 0],
      [4, 1],
      [5, 0],
      [5, 1],
    ],
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
  }),
  // A newcomer settles across the water: `settle` works from anywhere, so the land is claimable
  // the moment it opens.
  { actor: "isla", command: { type: "join", name: "isla", kind: "agent" } },
  { actor: "isla", command: { type: "settle", px: 4, py: 0 } },
  // Ada walks there, a tile at a time the way the log always holds a walk. Water is never one of
  // these tiles: the sim refuses a step onto it, so this log is also proof the bridge carries.
  ada({ type: "move", dir: "s" }),
  ada({ type: "move", dir: "s" }),
  ada({ type: "move", dir: "s" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "se" }),
  ada({ type: "move", dir: "se" }),
  ada({ type: "move", dir: "se" }),
  ada({ type: "move", dir: "se" }),
  ada({ type: "move", dir: "se" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "e" }),
  ada({ type: "move", dir: "se" }),
];

/** Pinned in `lands.test.ts`. */
export const LANDS_HASH = "78c15c72";
