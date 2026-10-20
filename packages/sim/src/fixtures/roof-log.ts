import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { FLOORS_CONFIG, FLOORS_LOG } from "./floors-log";

/**
 * The floors world after homes get roofs (RFC 0041). Dee, back on the ground floor of her hut on
 * plot (1, 0) with a loft over its middle, thatches it with a gable of leaf (free, since a free
 * block costs nothing), is handed plaster and swaps to a hip of it, takes that back down for her
 * plaster, and settles on a pitched roof of wood. `roofs.test.ts` replays it and checks the hash
 * pinned below, so a change to what a roof costs or how one is set that would replay a real log
 * differently fails loudly. Every older fixture hashes as before, because no log before this one
 * ever named a roof.
 */
export const ROOF_CONFIG = FLOORS_CONFIG;

const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const ROOF_LOG: Input[] = [
  ...FLOORS_LOG,
  // Thatch: a gable of leaf, which takes nothing, so it works whatever she holds.
  dee({ type: "set_roof", px: 1, py: 0, style: "gable", material: "leaf" }),
  // A hip of plaster she's handed takes 8 of it.
  town({ type: "test_grant", to: "dee", stacks: { plaster: 10 } }),
  dee({ type: "set_roof", px: 1, py: 0, style: "hip", material: "plaster" }),
  // Flat is no roof: the plaster comes back.
  dee({ type: "set_roof", px: 1, py: 0, style: "flat" }),
  // And one slope of wood to live under.
  dee({ type: "set_roof", px: 1, py: 0, style: "pitched", material: "wood" }),
];

/** `hashWorld(replay(ROOF_CONFIG, ROOF_LOG))`, pinned so a change to how this log replays fails. */
export const ROOF_HASH = "8a2efd30";
