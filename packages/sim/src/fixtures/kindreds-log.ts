import type { Input, WorldConfig } from "../types";
import { TOWN_ACTOR } from "../types";

/**
 * Kindreds (RFC 0033) from the switch on. `KINDREDS_SETUP` is a world of 5 by 5 plots with
 * thirteen people and Ada's three AIs, each on a plot of their own with a hearth, three days on so
 * they can found and host, with coins, items, and levels open and kindreds just opened.
 * `kindreds.test.ts` builds its worlds from it.
 *
 * The log then founds Lantern Row, invites and declines and takes an invite back, forms it with a
 * third household, makes a second steward, sets a hall on Ada's plot, and holds a kindred night
 * there that Bob hosts, which counts. It renames the kindred, takes its name down, founds a second
 * kindred whose invite lapses and which disbands for not forming, and a third that staff disband.
 *
 * `kindreds.test.ts` replays it to the hash pinned below, and `replay.test.ts` checks every split.
 */
export const KINDREDS_CONFIG: WorldConfig = {
  width: 40,
  height: 40,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** The day everyone settles: Tuesday, October 14, 2025. */
const SETTLED = 20_375;
/** Friday, October 17, 2025: three days on, so they can found and host. */
export const KINDREDS_DAY = SETTLED + 3;
const HOUR = 3_600_000;
const at = (day: number, hour: number) => day * 24 * HOUR + hour * HOUR;

/** Everyone, with the plot they settle. (2, 2) is the Commons. */
const KINDREDS_RESIDENTS: [id: string, kind: "human" | "agent", px: number, py: number][] = [
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

export const KINDREDS_SETUP: Input[] = [
  town({ type: "new_day", day: SETTLED }),
  town({ type: "open_economy" }),
  town({ type: "open_items" }),
  town({ type: "open_levels", firsts: [] }),
  ...KINDREDS_RESIDENTS.flatMap(([id, kind, px, py]): Input[] => [
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
  town({ type: "new_day", day: KINDREDS_DAY }),
  town({ type: "open_kindreds" }),
];

export const KINDREDS_LOG: Input[] = [
  ...KINDREDS_SETUP,
  ada({ type: "found_kindred", name: "Lantern Row" }),
  ada({ type: "invite_to_kindred", resident: "bob" }),
  ada({ type: "invite_to_kindred", resident: "ada_a" }),
  ada({ type: "invite_to_kindred", resident: "cy" }),
  ada({ type: "invite_to_kindred", resident: "dee" }),
  ada({ type: "invite_to_kindred", resident: "fay" }),
  ada({ type: "cancel_kindred_invite", resident: "fay" }),
  as("dee")({ type: "decline_kindred_invite", kindred: "k_1" }),
  bob({ type: "join_kindred", kindred: "k_1" }),
  as("ada_a")({ type: "join_kindred", kindred: "k_1" }),
  // The third household: it's formed.
  as("cy")({ type: "join_kindred", kindred: "k_1" }),
  ada({ type: "set_kindred_steward", resident: "bob", steward: true }),
  ada({ type: "set_kindred_hall", px: 0, py: 0 }),
  // Bob shares no plot with Ada, and hosts the kindred night at its hall all the same.
  bob({
    type: "schedule_event",
    kind: "gathering",
    title: "Friday at the Row",
    px: 0,
    py: 0,
    startsAt: at(KINDREDS_DAY, 19),
    minutes: 30,
    kindred: "k_1",
  }),
  town({ type: "event_start", event: "e_1" }),
  // Ada is home already, at her own plot.
  ...["bob", "cy", "ada_a", "dee"].map((id) => as(id)({ type: "join_event", event: "e_1" })),
  ...[1, 2, 3, 4, 5].map((slot) => town({ type: "event_tick", event: "e_1", slot })),
  town({ type: "event_end", event: "e_1" }),
  // Dee came from outside the kindred, so Dee is the guest who counts.
  town({ type: "credit_event", event: "e_1", guests: ["dee"] }),
  bob({ type: "name_kindred", name: "Lantern Lane" }),
  town({ type: "clear_kindred_name", kindred: "k_1" }),
  as("gus")({ type: "found_kindred", name: "Hearth Hollow" }),
  as("gus")({ type: "invite_to_kindred", resident: "hal" }),
  as("ivy")({ type: "found_kindred", name: "Quiet Pines" }),
  town({ type: "disband_kindred", kindred: "k_3", by: "staff_1" }),
  as("cy")({ type: "leave_kindred" }),
  // A week on, Gus's invite to Hal lapses. A week after that Hearth Hollow hasn't formed.
  town({ type: "new_day", day: KINDREDS_DAY + 7 }),
  town({ type: "new_day", day: KINDREDS_DAY + 14 }),
];

/** `hashWorld(replay(KINDREDS_CONFIG, KINDREDS_LOG))`, pinned when kindreds landed. */
export const KINDREDS_HASH = "44cd7dd1";
