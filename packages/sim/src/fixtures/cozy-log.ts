import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { ROOF_CONFIG, ROOF_LOG } from "./roof-log";

/**
 * The roof world after homes get cozy (RFC 0044). Dee, on the stairs in her hut on plot (1, 0)
 * with its hearth at (11, 3), is handed an armchair, a sofa and a bed. She puts the sofa between
 * the hearth and the doorway, the bed and the armchair in the north corners, rests in the armchair
 * and then on the bed, and walks out of the door across the sofa, which nobody could do across a
 * chair. `rest.test.ts` replays it and checks the hash pinned below, so a change to how a seat is
 * rested on or walked onto that would replay a real log differently fails loudly. Every older
 * fixture hashes as before, because no log before this one named a cozy piece or `rest`.
 */
export const COZY_CONFIG = ROOF_CONFIG;

const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const COZY_LOG: Input[] = [
  ...ROOF_LOG,
  town({ type: "test_grant", to: "dee", stacks: { armchair: 1, sofa: 1, bed: 1 } }),
  // The sofa on the way in, and the bed and the armchair in the corners.
  dee({ type: "place", x: 11, y: 4, block: "sofa" }),
  dee({ type: "place", x: 10, y: 2, block: "bed" }),
  dee({ type: "place", x: 12, y: 2, block: "armchair" }),
  // Off the stairs, into the armchair, and over to lie on the bed.
  dee({ type: "move", dir: "n" }),
  dee({ type: "rest", x: 12, y: 2 }),
  dee({ type: "move", dir: "w" }),
  dee({ type: "move", dir: "sw" }),
  dee({ type: "rest", x: 10, y: 2 }),
  // Up, and out of the door across the sofa.
  dee({ type: "move", dir: "s" }),
  dee({ type: "move", dir: "s" }),
  dee({ type: "move", dir: "e" }),
  dee({ type: "move", dir: "s" }),
  dee({ type: "move", dir: "s" }),
];

/** `hashWorld(replay(COZY_CONFIG, COZY_LOG))`, pinned so a change to how this log replays fails. */
export const COZY_HASH = "bd5f77ee";
