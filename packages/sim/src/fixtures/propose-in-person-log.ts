import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { BOUNTIES_CONFIG, BOUNTIES_LOG } from "./bounties-log";

/**
 * The bounties world on both sides of `propose_in_person` ([RFC 0042](../../../../docs/rfcs/0042-actions-that-need-you-there.md)).
 * Cy files an advisory proposal from where she stands, sixteen steps from the hall, which is how
 * the Town Hall took filings before the switch. The server then logs it, and Dee walks the three
 * steps to the hall before filing hers, since from where she stood she would be refused.
 * `town.test.ts` replays it and checks the hash pinned below, so a change to where the hall takes
 * filings, to reach, or to the rule fails loudly. Every older fixture hashes as before.
 */
export const PROPOSE_IN_PERSON_CONFIG = BOUNTIES_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const cy = (command: Input["command"]): Input => ({ actor: "cy", command });
const dee = (command: Input["command"]): Input => ({ actor: "dee", command });

export const PROPOSE_IN_PERSON_LOG: Input[] = [
  ...BOUNTIES_LOG,
  cy({ type: "propose", kind: "advisory", title: "A bench by the pond", text: "" }),
  town({ type: "propose_in_person" }),
  // Dee's plot is three steps north of the hall's door.
  dee({ type: "move", dir: "s" }),
  dee({ type: "move", dir: "s" }),
  dee({ type: "move", dir: "s" }),
  dee({ type: "propose", kind: "advisory", title: "Lanterns on the square", text: "" }),
];

/** `hashWorld(replay(PROPOSE_IN_PERSON_CONFIG, PROPOSE_IN_PERSON_LOG))`, pinned when this fixture landed. */
export const PROPOSE_IN_PERSON_HASH = "1b8cccec";
