import type { Input, WorldConfig } from "../types";
import { TOWN_ACTOR } from "../types";

/**
 * Both sides of `close_rule_gaps` (RFC 0053), in a regridded world whose Commons, slot (1, 1), has
 * its middle 8 by 8 (tiles 20 to 27) and a wild yard around it. Tom is townsfolk. Ada gives him 200
 * coins and he adds an upstairs, as townsfolk could before the switch. Ada's Town Hall build puts a
 * bench in the yard at (18, 18) and a lamp post in the middle, and both go up. Bob files a build
 * with a bench in the yard at (29, 29) and one in the middle, and while it is open the town logs
 * `close_rule_gaps`. Bob's closes after it: the middle bench goes up and the yard bench is skipped.
 * Cy's build, filed after the switch, lays a cobble path in the yard, which is still allowed. Tom's
 * upstairs stays. `town.test.ts` replays it to the hash pinned below, and `replay.test.ts` checks
 * every split point.
 */
export const RULE_GAPS_CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const DAY = 20_000;
const as =
  (actor: string) =>
  (command: Input["command"]): Input => ({ actor, command });
const town = as(TOWN_ACTOR);
const yes = (proposal: string): Input[] =>
  ["ada", "bob", "cy"].map((actor) => as(actor)({ type: "vote", proposal, choice: "yes" }));
const settled = (actor: string, px: number, py: number): Input[] => [
  as(actor)({ type: "join", name: actor, kind: "human" }),
  as(actor)({ type: "settle", px, py }),
  as(actor)({ type: "build_starter_home" }),
];

export const RULE_GAPS_LOG: Input[] = [
  town({ type: "new_day", day: DAY }),
  town({ type: "open_economy" }),
  town({ type: "open_items" }),
  town({ type: "starter_edges" }),
  town({ type: "plot_reach" }),
  town({ type: "walls_on_lines" }),
  town({ type: "regrid" }),
  ...settled("ada", 0, 0),
  ...settled("bob", 2, 0),
  ...settled("cy", 0, 2),
  ...settled("tom", 2, 2),
  town({ type: "set_townsfolk", ids: ["tom"] }),
  town({ type: "new_day", day: DAY + 3 }),
  town({ type: "test_grant", to: "ada", coins: 400 }),
  as("ada")({ type: "give_coins", to: "tom", amount: 200 }),
  as("tom")({ type: "add_floor", px: 2, py: 2 }),
  as("ada")({
    type: "propose",
    kind: "commons_build",
    title: "A bench on the green",
    text: "",
    blocks: [
      { x: 18, y: 18, block: "bench" },
      { x: 21, y: 26, block: "lamp_post" },
    ],
  }),
  ...yes("t_1"),
  town({ type: "new_day", day: DAY + 5 }),
  town({ type: "close_proposal", proposal: "t_1" }),
  as("bob")({
    type: "propose",
    kind: "commons_build",
    title: "Two more benches",
    text: "",
    blocks: [
      { x: 29, y: 29, block: "bench" },
      { x: 26, y: 26, block: "bench" },
    ],
  }),
  ...yes("t_2"),
  town({ type: "close_rule_gaps" }),
  as("cy")({
    type: "propose",
    kind: "commons_build",
    title: "A path across the yard",
    text: "",
    ground: [
      { x: 18, y: 20, ground: "cobble" },
      { x: 18, y: 21, ground: "cobble" },
    ],
  }),
  ...yes("t_3"),
  town({ type: "new_day", day: DAY + 7 }),
  town({ type: "close_proposal", proposal: "t_2" }),
  town({ type: "close_proposal", proposal: "t_3" }),
];

/** `hashWorld(replay(RULE_GAPS_CONFIG, RULE_GAPS_LOG))`, pinned so a change to how it replays fails. */
export const RULE_GAPS_HASH = "a9fb1238";
