import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { FINDS_CONFIG, FINDS_LOG } from "./finds-log";

/**
 * The finds world once it has water (RFC 0023). Day 20042 is 2024-11-15, autumn: Ada plants herbs,
 * then over two days picks up two more branches, picks her herbs, makes a fishing rod at her
 * workbench, and digs a pond inside her hut with two of her stones. She casts all ten of the day's
 * casts at whatever the server logged: a golden koi on a clear afternoon, two salmon, minnows, a
 * carp, an old boot, nothing at all, and a moonfish in the rain at night. She sells two salmon to the
 * town, fries her minnows, and gives Bob the koi. Next day her casts start over: she moves the pond
 * with a plan and a remove, and catches a perch from the new one. The Town Hall digs two tiles of
 * pond in the Commons for nobody's stone. In winter she catches a char in the snow and sells it.
 * `fishing.test.ts` checks the hash pinned below, so a change to what bites, a pond's cost, or the
 * day's casts that would replay the real log differently fails loudly.
 */
export const FISHING_CONFIG = FINDS_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const vote = (actor: string, proposal: string): Input => ({
  actor,
  command: { type: "vote", proposal, choice: "yes" },
});

export const FISHING_LOG: Input[] = [
  ...FINDS_LOG,
  town({ type: "new_day", day: 20042 }),
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "herb" } },
  // A branch out past the hut's east wall, and another the next day.
  town({ type: "new_day", day: 20043 }),
  { actor: "ada", command: { type: "move", dir: "e" } },
  { actor: "ada", command: { type: "gather", x: 7, y: 2 } },
  town({ type: "new_day", day: 20044 }),
  { actor: "ada", command: { type: "gather", x: 6, y: 2 } },
  { actor: "ada", command: { type: "harvest", x: 2, y: 2 } },
  // Three wood make a rod; two stone make a tile of pond.
  {
    actor: "ada",
    command: { type: "craft", recipe: "fishing_rod", x: 4, y: 3, label: "Lucky" },
  },
  { actor: "ada", command: { type: "move", dir: "w" } },
  { actor: "ada", command: { type: "place", x: 4, y: 4, block: "pond" } },
  // The day's ten casts, each with the roll, weather, and time of day the server logged.
  { actor: "ada", command: { type: "fish", roll: 7710, weather: "clear", timeOfDay: "day" } },
  { actor: "ada", command: { type: "fish", roll: 7000, weather: "clear", timeOfDay: "day" } },
  { actor: "ada", command: { type: "fish", roll: 6600, weather: "cloudy", timeOfDay: "dusk" } },
  { actor: "ada", command: { type: "fish", roll: 600, weather: "cloudy", timeOfDay: "dawn" } },
  { actor: "ada", command: { type: "fish", roll: 1000, weather: "rain", timeOfDay: "night" } },
  { actor: "ada", command: { type: "fish", roll: 2000, weather: "fog", timeOfDay: "dusk" } },
  { actor: "ada", command: { type: "fish", roll: 100, weather: "clear", timeOfDay: "day" } },
  { actor: "ada", command: { type: "fish", roll: 9900, weather: "clear", timeOfDay: "day" } },
  { actor: "ada", command: { type: "fish", roll: 9600, weather: "rain", timeOfDay: "night" } },
  { actor: "ada", command: { type: "fish", roll: 4500, weather: "rain", timeOfDay: "night" } },
  { actor: "ada", command: { type: "sell_to_town", item: "salmon", count: 2 } },
  { actor: "ada", command: { type: "craft", recipe: "fried_minnows", x: 4, y: 2 } },
  { actor: "ada", command: { type: "give", item: "golden_koi", to: "bob" } },
  // A new day: the casts start over, and the pond moves.
  town({ type: "new_day", day: 20045 }),
  { actor: "ada", command: { type: "fish", roll: 5500, weather: "clear", timeOfDay: "day" } },
  {
    actor: "ada",
    command: { type: "build", px: 0, py: 0, blocks: [{ x: 2, y: 3, block: "pond" }] },
  },
  { actor: "ada", command: { type: "remove", x: 4, y: 4 } },
  { actor: "ada", command: { type: "fish", roll: 3600, weather: "cloudy", timeOfDay: "day" } },
  // The Town Hall digs a pond in the Commons, from nobody's stone.
  ...["ada", "bob", "cy", "dee"].map((actor): Input => ({ actor, command: { type: "home" } })),
  {
    actor: "ada",
    command: {
      type: "propose",
      kind: "commons_build",
      title: "A pond for everyone",
      text: "Two tiles of water by the west path, to fish from.",
      blocks: [
        { x: 9, y: 11, block: "pond" },
        { x: 9, y: 12, block: "pond" },
      ],
    },
  },
  ...["ada", "bob", "cy", "dee"].map((who) => vote(who, "t_3")),
  town({ type: "new_day", day: 20047 }),
  town({ type: "close_proposal", proposal: "t_3" }),
  // Winter: the town buys char now, not salmon.
  town({ type: "new_day", day: 20058 }),
  { actor: "ada", command: { type: "fish", roll: 7400, weather: "snow", timeOfDay: "night" } },
  { actor: "ada", command: { type: "sell_to_town", item: "char" } },
];

/** `hashWorld(replay(FISHING_CONFIG, FISHING_LOG))`, pinned when fishing landed. */
export const FISHING_HASH = "2212a9fe";
