import type { Input, WorldConfig } from "../types";
import { TOWN_ACTOR } from "../types";

/**
 * Circles (RFC 0033) from the switch on. `CIRCLES_SETUP` is a world of 5 by 5 plots with
 * thirteen people and Ada's three AIs, each on a plot of their own with a hearth, three days on so
 * they can found and host, with coins, items, and levels open and circles just opened.
 * `circles.test.ts` builds its worlds from it.
 *
 * The log then founds Lantern Row, invites and declines and takes an invite back, forms it with a
 * third household, makes a second steward, sets a hall on Ada's plot, and holds a circle night
 * there that Bob hosts, which counts. It renames the circle, takes its name down, founds a second
 * circle whose invite lapses and which disbands for not forming, and a third that staff disband.
 *
 * `circles.test.ts` replays it to the hash pinned below, and `replay.test.ts` checks every split.
 */
export const CIRCLES_CONFIG: WorldConfig = {
  width: 40,
  height: 40,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** The day everyone settles: Tuesday, October 14, 2025. */
const SETTLED = 20_375;
/** Friday, October 17, 2025: three days on, so they can found and host. */
export const CIRCLES_DAY = SETTLED + 3;
const HOUR = 3_600_000;
const at = (day: number, hour: number) => day * 24 * HOUR + hour * HOUR;

/** Everyone, with the plot they settle. (2, 2) is the Commons. */
const CIRCLES_RESIDENTS: [id: string, kind: "human" | "agent", px: number, py: number][] = [
  ["ada", "human", 0, 0],
  ["bob", "human", 1, 0],
  ["cy", "human", 2, 0],
  ["dee", "human", 3, 0],
  ["fay", "human", 4, 0],
  ["gus", "human", 0, 1],
  ["hal", "human", 1, 1],
  ["ivy", "human", 2, 1],
  ["jo", "human", 3, 1],
  ["kit", "human", 4, 1],
  ["lu", "human", 0, 2],
  ["mo", "human", 1, 2],
  ["ned", "human", 3, 2],
  ["ada_a", "agent", 4, 2],
  ["ada_b", "agent", 0, 3],
  ["ada_c", "agent", 1, 3],
];

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const as =
  (actor: string) =>
  (command: Input["command"]): Input => ({ actor, command });
const ada = as("ada");
const bob = as("bob");

export const CIRCLES_SETUP: Input[] = [
  town({ type: "new_day", day: SETTLED }),
  town({ type: "open_economy" }),
  town({ type: "open_items" }),
  town({ type: "open_levels", firsts: [] }),
  ...CIRCLES_RESIDENTS.flatMap(([id, kind, px, py]): Input[] => [
    as(id)({ type: "join", name: id, kind }),
    as(id)({ type: "settle", px, py }),
    as(id)({ type: "set_hearth", x: px * 8 + 3, y: py * 8 + 3 }),
  ]),
  town({
    type: "set_owner_pairs",
    pairs: [
      ["ada", "ada_a"],
      ["ada", "ada_b"],
      ["ada", "ada_c"],
    ],
  }),
  town({ type: "new_day", day: CIRCLES_DAY }),
  town({ type: "open_circles" }),
];

export const CIRCLES_LOG: Input[] = [
  ...CIRCLES_SETUP,
  ada({ type: "found_circle", name: "Lantern Row" }),
  ada({ type: "invite_to_circle", resident: "bob" }),
  ada({ type: "invite_to_circle", resident: "ada_a" }),
  ada({ type: "invite_to_circle", resident: "cy" }),
  ada({ type: "invite_to_circle", resident: "dee" }),
  ada({ type: "invite_to_circle", resident: "fay" }),
  ada({ type: "cancel_circle_invite", resident: "fay" }),
  as("dee")({ type: "decline_circle_invite", circle: "c_1" }),
  bob({ type: "join_circle", circle: "c_1" }),
  as("ada_a")({ type: "join_circle", circle: "c_1" }),
  // The third household: it's formed.
  as("cy")({ type: "join_circle", circle: "c_1" }),
  ada({ type: "set_circle_steward", resident: "bob", steward: true }),
  ada({ type: "set_circle_hall", px: 0, py: 0 }),
  // Bob shares no plot with Ada, and hosts the circle night at its hall all the same.
  bob({
    type: "schedule_event",
    kind: "gathering",
    title: "Friday at the Row",
    px: 0,
    py: 0,
    startsAt: at(CIRCLES_DAY, 19),
    minutes: 30,
    circle: "c_1",
  }),
  town({ type: "event_start", event: "e_1" }),
  // Ada is home already, at her own plot.
  ...["bob", "cy", "ada_a", "dee"].map((id) => as(id)({ type: "join_event", event: "e_1" })),
  ...[1, 2, 3, 4, 5].map((slot) => town({ type: "event_tick", event: "e_1", slot })),
  town({ type: "event_end", event: "e_1" }),
  // Dee came from outside the circle, so Dee is the guest who counts.
  town({ type: "credit_event", event: "e_1", guests: ["dee"] }),
  bob({ type: "name_circle", name: "Lantern Lane" }),
  town({ type: "clear_circle_name", circle: "c_1" }),
  as("gus")({ type: "found_circle", name: "Hearth Hollow" }),
  as("gus")({ type: "invite_to_circle", resident: "hal" }),
  as("ivy")({ type: "found_circle", name: "Quiet Pines" }),
  town({ type: "disband_circle", circle: "c_3", by: "staff_1" }),
  as("cy")({ type: "leave_circle" }),
  // A week on, Gus's invite to Hal lapses. A week after that Hearth Hollow hasn't formed.
  town({ type: "new_day", day: CIRCLES_DAY + 7 }),
  town({ type: "new_day", day: CIRCLES_DAY + 14 }),
];

/** `hashWorld(replay(CIRCLES_CONFIG, CIRCLES_LOG))`, pinned again when circle ids became `c_1` (decision 0318). */
export const CIRCLES_HASH = "93220153";
