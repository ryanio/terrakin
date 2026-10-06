import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PRESENCE_CONFIG, PRESENCE_LOG } from "./presence-log";

/**
 * The presence world after offline routines (RFC 0009): Bob, Cy, and Dee turn routines on (each
 * coming back online to do it, then going idle), and a new day starts. The runner walks Bob home
 * and strolls him out of his hut and back in two legs, walks Cy home, and strolls Ada out of her
 * hut, which she turned on while she was here. The next day Bob turns his routines off.
 * `routines.test.ts` replays it to the hash pinned below, so a change to how routines are stored
 * or how a step commits fails loudly. Every older fixture hashes as before.
 */
export const ROUTINES_CONFIG = PRESENCE_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const ROUTINES_LOG: Input[] = [
  ...PRESENCE_LOG,
  {
    actor: "bob",
    command: {
      type: "set_routines",
      routines: [
        { kind: "stroll", hour: 19 },
        { kind: "walk_home", hour: 18 },
      ],
    },
  },
  {
    actor: "cy",
    command: {
      type: "set_routines",
      routines: [
        { kind: "walk_home", hour: 17 },
        { kind: "greet", max: 2 },
      ],
    },
  },
  { actor: "dee", command: { type: "set_routines", routines: [{ kind: "greet", max: 3 }] } },
  { actor: "ada", command: { type: "set_routines", routines: [{ kind: "stroll", hour: 7 }] } },
  town({ type: "leave_idle", ids: ["ada", "bob", "cy", "dee"] }),
  town({ type: "new_day", day: 20016 }),
  // Bob stood a step west of his hearth, inside his hut.
  town({ type: "routine_step", resident: "bob", routine: "walk_home", step: { type: "home" } }),
  // Out through his doorway, and back in.
  town({
    type: "routine_step",
    resident: "bob",
    routine: "stroll",
    step: { type: "putter", steps: ["s", "s", "s"] },
  }),
  town({
    type: "routine_step",
    resident: "bob",
    routine: "stroll",
    step: { type: "putter", steps: ["n", "n", "n"] },
  }),
  town({ type: "routine_step", resident: "cy", routine: "walk_home", step: { type: "home" } }),
  town({
    type: "routine_step",
    resident: "ada",
    routine: "stroll",
    step: { type: "putter", steps: ["s", "s", "s"] },
  }),
  town({ type: "new_day", day: 20017 }),
  { actor: "bob", command: { type: "set_routines", routines: [] } },
];

/** `hashWorld(replay(ROUTINES_CONFIG, ROUTINES_LOG))`, pinned when offline routines landed. */
export const ROUTINES_HASH = "fc15a2d8";
