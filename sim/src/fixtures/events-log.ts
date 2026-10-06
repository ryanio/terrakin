import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PRESENCE_CONFIG, PRESENCE_LOG } from "./presence-log";

/**
 * The presence world after hosted events (RFC 0010). Dee books the Commons for the evening (her
 * deposit is held), Ada books her own plot for tomorrow, and Bob books his and calls it off. The
 * town puts the harvest night on the calendar. Dee's gathering starts; Ada walks over with
 * `join_event`, and Bob and Clem come back online with theirs. Cy comes too but goes idle after the
 * first sample, so three attend and Dee's deposit comes back. A maintainer calls off Ada's session.
 * Next day the harvest night runs with Bob still in the Commons. `events.test.ts` replays it to the
 * hash pinned below, so a change to scheduling, sampling, attendance, or the deposit that would
 * replay the real log differently fails loudly. Every older fixture hashes as before.
 */
export const EVENTS_CONFIG = PRESENCE_CONFIG;

const DAY = 20_015;
const HOUR = 3_600_000;
/** `hour` o'clock UTC on world day `day`, in ms. */
const at = (day: number, hour: number) => day * 24 * HOUR + hour * HOUR;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const tick = (event: string, slot: number) => town({ type: "event_tick", event, slot });

export const EVENTS_LOG: Input[] = [
  ...PRESENCE_LOG,
  {
    actor: "dee",
    command: {
      type: "schedule_event",
      kind: "gathering",
      title: "Lantern walk",
      text: "Bring a lantern.",
      px: 1,
      py: 1,
      startsAt: at(DAY, 19),
      minutes: 30,
    },
  },
  {
    actor: "ada",
    command: {
      type: "schedule_event",
      kind: "listening",
      title: "Sunday records",
      px: 0,
      py: 0,
      startsAt: at(DAY + 1, 20),
      minutes: 60,
    },
  },
  {
    actor: "bob",
    command: {
      type: "schedule_event",
      kind: "class",
      title: "Knots",
      px: 2,
      py: 0,
      startsAt: at(DAY + 2, 17),
      minutes: 45,
    },
  },
  { actor: "bob", command: { type: "cancel_event", event: "e_3" } },
  town({
    type: "schedule_town_event",
    key: "harvest-night-2026",
    kind: "gathering",
    title: "Harvest night",
    text: "Lanterns in the Commons to see autumn out.",
    startsAt: at(DAY + 1, 18),
    minutes: 540,
  }),
  town({ type: "event_start", event: "e_1" }),
  { actor: "ada", command: { type: "join_event", event: "e_1" } },
  { actor: "bob", command: { type: "join_event", event: "e_1" } },
  { actor: "clem", command: { type: "join_event", event: "e_1" } },
  { actor: "cy", command: { type: "join_event", event: "e_1" } },
  tick("e_1", 1),
  town({ type: "leave_idle", ids: ["cy"] }),
  tick("e_1", 2),
  // The server missed the third mark.
  tick("e_1", 4),
  tick("e_1", 5),
  town({ type: "event_end", event: "e_1" }),
  town({ type: "void_event", event: "e_2", by: "staff_0123456789ab" }),
  town({ type: "new_day", day: DAY + 1 }),
  town({ type: "event_start", event: "e_4" }),
  tick("e_4", 1),
  tick("e_4", 2),
  town({ type: "event_end", event: "e_4" }),
];

/** `hashWorld(replay(EVENTS_CONFIG, EVENTS_LOG))`, pinned when hosted events landed. */
export const EVENTS_HASH = "5dc8849e";
