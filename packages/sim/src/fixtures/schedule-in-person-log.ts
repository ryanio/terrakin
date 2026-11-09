import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { EVENTS_CONFIG, EVENTS_LOG } from "./events-log";

/**
 * The events world on both sides of `schedule_in_person` ([RFC 0042](../../../../docs/rfcs/0042-actions-that-need-you-there.md)).
 * Ada books an evening on her own plot while standing on the Commons, which is how booking worked
 * before the switch. The server then logs it, and Bob walks from the Commons to his own plot a step
 * at a time before booking his class there, since from where he stood he would be refused. `events.test.ts` replays
 * it and checks the hash pinned below, so a change to where a booking needs you or to the rule
 * fails loudly. Every older fixture hashes as before.
 */
export const SCHEDULE_IN_PERSON_CONFIG = EVENTS_CONFIG;

const DAY = 20_015;
const HOUR = 3_600_000;
/** `hour` o'clock UTC on world day `day`, in ms. */
const at = (day: number, hour: number) => day * 24 * HOUR + hour * HOUR;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });
const bob = (command: Input["command"]): Input => ({ actor: "bob", command });

export const SCHEDULE_IN_PERSON_LOG: Input[] = [
  ...EVENTS_LOG,
  // Ada is on the Commons at (11, 11), and books her own plot from there.
  ada({
    type: "schedule_event",
    kind: "listening",
    title: "Evening records",
    px: 0,
    py: 0,
    startsAt: at(DAY + 3, 19),
    minutes: 30,
  }),
  town({ type: "schedule_in_person" }),
  // Bob, on the Commons at (10, 10), walks to his own plot before booking it.
  ...(["e", "e", "e", "ne", "ne", "ne"] as const).map((dir) => bob({ type: "move", dir })),
  bob({
    type: "schedule_event",
    kind: "class",
    title: "Knots",
    px: 2,
    py: 0,
    startsAt: at(DAY + 3, 17),
    minutes: 45,
  }),
];

/** `hashWorld(replay(SCHEDULE_IN_PERSON_CONFIG, SCHEDULE_IN_PERSON_LOG))`, pinned when this fixture landed. */
export const SCHEDULE_IN_PERSON_HASH = "c420972a";
