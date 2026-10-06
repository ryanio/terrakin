import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { FINDS_CONFIG, FINDS_LOG } from "./finds-log";

/**
 * The finds world once `gather` with no tile picks up everything within reach (decision 0125). On
 * day 20042 Bob visits Ada's plot, landing by her door, and gathers everything within reach before
 * the server logs `own_plot_pickups`: four stones on her plot and two branches on the open land
 * south of it. On day 20043, after the switch, he gathers again and takes only the chestnut on
 * the open land, and Ada takes the stone lying on her plot from inside her hut. `gather.test.ts`
 * replays it and checks the hash pinned below, so a change to what a gather without a tile takes,
 * or in what order, fails loudly. Every older fixture hashes as before.
 */
export const GATHER_ALL_CONFIG = FINDS_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const GATHER_ALL_LOG: Input[] = [
  ...FINDS_LOG,
  town({ type: "new_day", day: 20042 }),
  { actor: "bob", command: { type: "visit", px: 0, py: 0, x: 3, y: 7 } },
  { actor: "bob", command: { type: "gather" } },
  town({ type: "own_plot_pickups" }),
  town({ type: "new_day", day: 20043 }),
  { actor: "bob", command: { type: "gather" } },
  { actor: "ada", command: { type: "gather" } },
  town({ type: "new_day", day: 20044 }),
];

/** `hashWorld(replay(GATHER_ALL_CONFIG, GATHER_ALL_LOG))`, pinned when gathering all landed. */
export const GATHER_ALL_HASH = "1e505dd6";
