import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { ENTITLEMENTS_CONFIG, ENTITLEMENTS_LOG } from "./entitlements-log";

/**
 * The entitlements world after presence comes with acting (RFC 0014, step 4): the server turns it
 * on, an idle sweep takes three residents offline in one input, and they come back by acting: a
 * step, a note, and a gift each bring their resident online in the same input. A new day passes,
 * the sweep takes the rest, Ada collects her allowance at her hearth with an implicit join, and an
 * explicit `join` and `leave` still work. `presence.test.ts` replays it and checks the hash pinned
 * below, so a change to how the implicit join or `leave_idle` commits fails loudly. Every older
 * fixture hashes as before.
 */
export const PRESENCE_CONFIG = ENTITLEMENTS_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const PRESENCE_LOG: Input[] = [
  ...ENTITLEMENTS_LOG,
  town({ type: "implicit_presence" }),
  town({ type: "leave_idle", ids: ["bob", "cy", "dee"] }),
  { actor: "bob", command: { type: "move", dir: "w" } },
  { actor: "cy", command: { type: "profile", note: "back again" } },
  { actor: "dee", command: { type: "give_coins", to: "bob", amount: 3 } },
  town({ type: "new_day", day: 20015 }),
  town({ type: "leave_idle", ids: ["ada", "bob", "clem", "cy", "dee"] }),
  { actor: "ada", command: { type: "home" } },
  { actor: "bob", command: { type: "join", name: "Bob", kind: "agent" } },
  { actor: "bob", command: { type: "leave" } },
];

/** `hashWorld(replay(PRESENCE_CONFIG, PRESENCE_LOG))`, pinned when implicit presence landed. */
export const PRESENCE_HASH = "a0116743";
