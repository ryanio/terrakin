import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { GATHER_ALL_CONFIG, GATHER_ALL_LOG } from "./gather-all-log";

/**
 * The gather-all world on both sides of `open_way_pickups` ([RFC 0046](../../../../docs/rfcs/0046-streets.md)).
 * On day 20048 the town opens a one-tile public way at (0, 6) on Ada's plot, where a stone lies.
 * Bob, standing on her plot at (3, 7), gathers everything within reach: the branches on the open
 * land south of it, but not the stone, since owners-only pickups keep a way on her plot hers. The
 * server then logs the switch, and his next gather takes the stone. `gather.test.ts` replays it and
 * checks the hash pinned below, so a change to whose a way's pickups are fails loudly. Every older
 * fixture hashes as before.
 */
export const WAY_PICKUPS_CONFIG = GATHER_ALL_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const bob = (command: Input["command"]): Input => ({ actor: "bob", command });

export const WAY_PICKUPS_LOG: Input[] = [
  ...GATHER_ALL_LOG,
  town({ type: "new_day", day: 20048 }),
  town({ type: "open_way", tiles: [[0, 6]] }),
  bob({ type: "gather" }),
  town({ type: "open_way_pickups" }),
  bob({ type: "gather" }),
];

/** `hashWorld(replay(WAY_PICKUPS_CONFIG, WAY_PICKUPS_LOG))`, pinned when this fixture landed. */
export const WAY_PICKUPS_HASH = "e493456c";
