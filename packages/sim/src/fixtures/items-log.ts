import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { POST_ECONOMY_CONFIG, POST_ECONOMY_LOG } from "./post-economy-log";

/**
 * The post-economy world after items open (RFC 0005, step 2): the starter kit and the daily
 * pantry, stations placed, herbs and flowers planted and grown over skipped days, harvests, two
 * made things, and gifts of a made thing and of seeds. `items.test.ts` replays it and checks the
 * hash pinned below, so once items are live a change to the catalog, `ITEMS`, or an item rule that
 * would replay the real log differently fails loudly.
 */
export const ITEMS_CONFIG = POST_ECONOMY_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const ITEMS_LOG: Input[] = [
  ...POST_ECONOMY_LOG,
  town({ type: "open_items" }),
  // Ada is on her hearth at (3, 3): stepping off and back brings her starter kit.
  { actor: "ada", command: { type: "move", dir: "s" } },
  { actor: "ada", command: { type: "move", dir: "n" } },
  { actor: "ada", command: { type: "place", x: 2, y: 2, block: "planter" } },
  { actor: "ada", command: { type: "place", x: 4, y: 2, block: "kitchen" } },
  { actor: "ada", command: { type: "place", x: 4, y: 3, block: "workbench" } },
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "herb" } },
  town({ type: "new_day", day: DAY + 9 }),
  { actor: "ada", command: { type: "home" } },
  { actor: "ada", command: { type: "harvest", x: 2, y: 2 } },
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "flower" } },
  { actor: "ada", command: { type: "craft", recipe: "herb_tea", x: 4, y: 2, label: "Calm" } },
  { actor: "ada", command: { type: "give", item: "i_1", to: "bob", note: "for you" } },
  { actor: "ada", command: { type: "give", item: "herb_seed", to: "dee" } },
  town({ type: "new_day", day: DAY + 11 }),
  { actor: "ada", command: { type: "harvest", x: 2, y: 2 } },
  { actor: "ada", command: { type: "craft", recipe: "bouquet", x: 4, y: 3 } },
  { actor: "ada", command: { type: "give", item: "bouquet", to: "cy" } },
];

/** `hashWorld(replay(ITEMS_CONFIG, ITEMS_LOG))`, pinned when items landed. */
export const ITEMS_HASH = "eb89cf5e";
