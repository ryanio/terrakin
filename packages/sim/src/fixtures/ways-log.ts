import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PRESENCE_CONFIG, PRESENCE_LOG } from "./presence-log";

/**
 * The presence world once the town lays a public way ([RFC 0046](../../../../docs/rfcs/0046-streets.md)).
 * The way runs down column x 1 of Ada's plot, which is the west wall of her starter hut, so the
 * town clears the wall's five blocks first (`clear_block`, each back to her as she would have
 * taken it up), opens the way, and rebuilds her home with a door onto it (`rebuild_home`). She
 * walks out of the door onto the way, and the town takes one tile of it back up. `ways.test.ts`
 * replays it and checks the hash pinned below.
 */
export const WAYS_CONFIG = PRESENCE_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

/** The way: x 1, from the top of Ada's plot to its bottom. */
export const WAYS_TILES: [number, number][] = Array.from({ length: 8 }, (_, y) => [1, y]);

export const WAYS_LOG: Input[] = [
  ...PRESENCE_LOG,
  town({ type: "clear_block", x: 1, y: 1 }),
  town({ type: "clear_block", x: 1, y: 2 }),
  town({ type: "clear_block", x: 1, y: 3 }),
  town({ type: "clear_block", x: 1, y: 4 }),
  town({ type: "clear_block", x: 1, y: 5 }),
  town({ type: "open_way", tiles: WAYS_TILES }),
  // Her home's west side is the planter at (2, 2), the fence at (2, 4), and the hut's corners;
  // the gap at (2, 3) gets a door, which opens onto the way.
  town({ type: "rebuild_home", px: 0, py: 0, blocks: [{ x: 2, y: 3, block: "door" }], remove: [] }),
  ada({ type: "move", dir: "w" }),
  ada({ type: "move", dir: "w" }),
  ada({ type: "move", dir: "s" }),
  town({ type: "close_way", tiles: [[1, 7]] }),
];

/** Pinned in `ways.test.ts` when public ways landed. */
export const WAYS_HASH = "ce2fd8a3";
