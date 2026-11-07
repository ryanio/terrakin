import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { COZY_CONFIG, COZY_LOG } from "./cozy-log";

/**
 * The cozy world once pieces turn (`turns.ts`). Dee steps back into the doorway of her hut on plot
 * (1, 0), with the sofa just inside it and the bed and the armchair in the north corners. She turns
 * the sofa to face north into the room and the armchair to face west, is handed a rocking chair and
 * sets it down facing east, turns the armchair back to face south, and takes the rocking chair up
 * again. `turns.test.ts` replays it and checks the hash pinned below. Every older fixture hashes as
 * before, because no log before this one named a turn.
 */
export const TURNS_CONFIG = COZY_CONFIG;

const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const TURNS_LOG: Input[] = [
  ...COZY_LOG,
  // Back into the doorway, where the whole room is in reach.
  dee({ type: "move", dir: "n" }),
  dee({ type: "turn", x: 11, y: 4, turn: 180 }),
  dee({ type: "turn", x: 12, y: 2, turn: 90 }),
  town({ type: "test_grant", to: "dee", stacks: { rocking_chair: 1 } }),
  dee({ type: "place", x: 12, y: 3, block: "rocking_chair", turn: 270 }),
  dee({ type: "turn", x: 12, y: 2, turn: 0 }),
  dee({ type: "remove", x: 12, y: 3 }),
];

/** `hashWorld(replay(TURNS_CONFIG, TURNS_LOG))`, pinned so a change to how this log replays fails. */
export const TURNS_HASH = "b7bf145f";
