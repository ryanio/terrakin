import type { Direction, Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PETS_CONFIG, PETS_LOG } from "./pets-log";

/**
 * The pets world with levels open, out on the green (RFC 0045). Cy adopts a dog. Ada walks to the
 * green in the middle of the Commons, around (12, 12), and takes her cat out with nobody else there.
 * Bob, of her household, brings his tortoise: it meets her cat, and the meeting counts for neither.
 * Cy, of another household, brings his dog: it meets both, and the first counted meeting of each
 * pet's day earns all three owners Hosting points. The next day Ada takes her cat out again, alone.
 * `pets.test.ts` checks the hash pinned below.
 */
export const PET_PARK_CONFIG = PETS_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const walk = (actor: string, dirs: Direction[]): Input[] =>
  dirs.map((dir) => ({ actor, command: { type: "move", dir } }));

export const PET_PARK_LOG: Input[] = [
  ...PETS_LOG,
  town({ type: "open_levels", firsts: [] }),
  { actor: "cy", command: { type: "adopt_pet", kind: "dog", coat: "golden", name: "Rex" } },
  // Ada comes from her hearth at (3, 3) to (9, 9), the green's north-west corner.
  ...walk("ada", ["s", "s", "s", "e", "e", "e", "se", "se", "se"]),
  { actor: "ada", command: { type: "walk_pet" } },
  // Bob comes from (19, 3) to (15, 9).
  ...walk("bob", ["s", "s", "s", "w", "sw", "sw", "sw"]),
  { actor: "bob", command: { type: "walk_pet" } },
  // Cy comes from (3, 18) round his hut to (9, 15).
  ...walk("cy", ["s", "s", "s", "s", "e", "e", "e", "n", "n", "n", "n", "ne", "ne", "ne"]),
  { actor: "cy", command: { type: "walk_pet" } },
  town({ type: "new_day", day: DAY + 20 }),
  { actor: "ada", command: { type: "walk_pet" } },
];

/** `hashWorld(replay(PET_PARK_CONFIG, PET_PARK_LOG))`, pinned when the green landed. */
export const PET_PARK_HASH = "c4842ad2";
