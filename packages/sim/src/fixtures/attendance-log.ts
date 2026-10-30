import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { EVENTS_CONFIG, EVENTS_LOG } from "./events-log";

/**
 * The events world on both sides of `attend_at_ten` (issue #126). Every event in the events log
 * settled under the old rule, a third of the samples. The town then logs the switch, and Dee's
 * evening runs at the Commons: she joins the town's late gathering, is seen at its first two
 * samples (10 minutes), and leaves, and still attends under the new rule, where the old one
 * asked for 4 of its 11 samples. `events.test.ts` replays it to the hash pinned below, so a
 * change to which inputs read which rule fails loudly. Every older fixture hashes as before.
 */
export const ATTENDANCE_CONFIG = EVENTS_CONFIG;

const DAY = 20_015;
const HOUR = 3_600_000;
/** `hour` o'clock UTC on world day `day`, in ms. */
const at = (day: number, hour: number) => day * 24 * HOUR + hour * HOUR;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const tick = (event: string, slot: number) => town({ type: "event_tick", event, slot });

export const ATTENDANCE_LOG: Input[] = [
  ...EVENTS_LOG,
  town({ type: "attend_at_ten" }),
  town({
    type: "schedule_town_event",
    key: "late-gathering",
    kind: "gathering",
    title: "Late gathering",
    startsAt: at(DAY + 1, 20),
    minutes: 60,
  }),
  town({ type: "event_start", event: "e_5" }),
  { actor: "dee", command: { type: "join_event", event: "e_5" } },
  tick("e_5", 1),
  tick("e_5", 2),
  { actor: "dee", command: { type: "leave" } },
  tick("e_5", 3),
  tick("e_5", 4),
  tick("e_5", 5),
  tick("e_5", 6),
  tick("e_5", 7),
  tick("e_5", 8),
  tick("e_5", 9),
  tick("e_5", 10),
  tick("e_5", 11),
  town({ type: "event_end", event: "e_5" }),
];

/** `hashWorld(replay(ATTENDANCE_CONFIG, ATTENDANCE_LOG))`, pinned when attendance moved to 10 minutes. */
export const ATTENDANCE_HASH = "b1454b79";
