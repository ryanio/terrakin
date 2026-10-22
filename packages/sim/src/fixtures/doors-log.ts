import type { Direction, Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { WALK_CONFIG, WALK_LOG } from "./walk-log";

/**
 * The walking world once homes have doors (decision 0349). Eve settles plot (0, 1) and builds her
 * starter home before the server logs `starter_doors`, so it has the open doorway at (3, 13) that
 * every starter home had. After the switch Fay settles plot (2, 1), and hers gets a door at
 * (19, 13), which she walks out through. Then Eve hangs a door in her own doorway and walks out
 * through it too. `walk.test.ts` replays it to the hash pinned below, so a change to how a door is
 * placed or walked that would replay a real log differently fails loudly. Every older fixture
 * hashes as before, because no log before this one named a door.
 */
export const DOORS_CONFIG = WALK_CONFIG;

const step = (actor: string, ...dirs: Direction[]): Input[] =>
  dirs.map((dir) => ({ actor, command: { type: "move", dir } }));

export const DOORS_LOG: Input[] = [
  ...WALK_LOG,
  { actor: "eve", command: { type: "settle", px: 0, py: 1 } },
  { actor: "eve", command: { type: "build_starter_home" } },
  { actor: TOWN_ACTOR, command: { type: "starter_doors" } },
  { actor: "fay", command: { type: "settle", px: 2, py: 1 } },
  { actor: "fay", command: { type: "build_starter_home" } },
  // From the hearth at (19, 11), south through the door at (19, 13) and out.
  ...step("fay", "s", "s", "s"),
  { actor: "eve", command: { type: "place", x: 3, y: 13, block: "door" } },
  ...step("eve", "s", "s", "s"),
];

/** `hashWorld(replay(DOORS_CONFIG, DOORS_LOG))`, pinned when doors came in. */
export const DOORS_HASH = "d7397ee3";
