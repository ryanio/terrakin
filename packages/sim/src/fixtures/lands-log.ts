import type { Command, Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PRESENCE_CONFIG, PRESENCE_LOG } from "./presence-log";

/**
 * The presence world once a land opens beyond the first grid ([RFC 0038](../../../../docs/rfcs/0038-new-lands.md)).
 * Downtown is 3 by 3 plots of 8 tiles; this adds one plot-width of water east of it and a 2 by 2
 * island beyond, with a square of its own under its west column for its hall and its counter,
 * bridged along the Commons' latitude, then walks a resident over the bridge and settles them
 * there. `lands.test.ts` replays it and checks the hash pinned below, so a change to how a land
 * opens, where the water is, what the bridge reaches, or where an island's buildings stand fails
 * loudly. Every older fixture has no land at all, so it hashes as it did.
 */
export const LANDS_CONFIG = PRESENCE_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

/**
 * The island, as the town opens it: one plot-width of water east of downtown (x 24 to 31), a 2
 * by 2 island beyond it (x 32 to 47), a square of its own under its west column, and a bridge
 * along the Commons' latitude. Exported because every test that needs a land open sends this
 * one, so the sim's tests have one island between them rather than a copy per file.
 */
export const LANDS_ISLAND: Extract<Command, { type: "open_land" }> = {
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
  // Just south of the island's west column: its hall and its counter stand here, and nobody
  // claims it (decision 0328).
  square: [4, 2],
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

export const LANDS_LOG: Input[] = [
  ...PRESENCE_LOG,
  town(LANDS_ISLAND),
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

/**
 * Pinned in `lands.test.ts`. It moved once, when the island gained the square its hall and its
 * counter stand on (decision 0328): the only difference in the whole world is the land's own
 * `square`, with Ada on the same tile and Isla's plot unchanged. No live log holds an `open_land`,
 * so nothing replayed differently.
 */
export const LANDS_HASH = "59381557";
