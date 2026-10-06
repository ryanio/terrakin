import type { Direction, Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { SHOP_CONFIG, SHOP_LOG } from "./shop-log";

/**
 * The shop world after walking went eight ways around solid buildings (decision 0072). Before the
 * switch, Eve walks onto the Town Hall's door and Fay onto the shop, then goes offline there.
 * `solid_buildings` steps both off. Eve walks diagonally around the hall's west end to the far
 * side and putters on diagonally, and Fay comes back where she was moved to. `walk.test.ts`
 * replays it to the hash pinned below, so a change to the walking rule that would replay the real
 * log differently fails loudly.
 */
export const WALK_CONFIG = SHOP_CONFIG;

const step = (actor: string, ...dirs: Direction[]): Input[] =>
  dirs.map((dir) => ({ actor, command: { type: "move", dir } }));

export const WALK_LOG: Input[] = [
  ...SHOP_LOG,
  // Spawn is (12, 12); the hall stands on x 11 to 13, y 8 and 9, and the shop on y 14 and 15.
  { actor: "eve", command: { type: "join", name: "Eve", kind: "human" } },
  ...step("eve", "n", "n", "n"),
  { actor: "fay", command: { type: "join", name: "Fay", kind: "agent" } },
  ...step("fay", "s", "s"),
  { actor: "fay", command: { type: "leave" } },
  { actor: TOWN_ACTOR, command: { type: "solid_buildings" } },
  // Round the hall's west end, never past its corner, to stand behind it.
  ...step("eve", "sw", "nw", "n", "n", "n", "e", "e"),
  { actor: "eve", command: { type: "putter", steps: ["ne", "e", "se"] } },
  { actor: "fay", command: { type: "join", name: "Fay", kind: "agent" } },
  ...step("fay", "ne"),
];

/** `hashWorld(replay(WALK_CONFIG, WALK_LOG))`, pinned when walking went eight ways. */
export const WALK_HASH = "56744c2d";
