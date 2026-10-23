import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { FISHING_CONFIG, FISHING_LOG } from "./fishing-log";

/**
 * The fishing world once clay is out (RFC 0047). In winter the server logs `open_clay`, and Ada
 * gathers the clay lying within reach of her hearth. The town grants her the rest of what the log
 * needs (a test grant, as the test world's route sends), and she places a kiln inside her hut for
 * four stone and loads a bowl in a moss glaze, paid for with a bunch of herbs. Next day it comes out
 * crackled, at the roll the server logged, and she loads a bare vase, which comes out speckled the
 * day after. A teapot in a sea glaze comes out plain. She gives Bob the bowl, lists the vase, and
 * shows the teapot on a pedestal.
 * `pottery.test.ts` checks the hash pinned below, so a change to where clay lies, a kiln's cost, a
 * glaze's cost, or the finishes that would replay the real log differently fails loudly.
 */
export const KILN_CONFIG = FISHING_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

export const KILN_LOG: Input[] = [
  ...FISHING_LOG,
  town({ type: "open_clay" }),
  // Clay lies at (3, 0) and (0, 2), both on her own plot and within reach of her hearth.
  ada({ type: "gather" }),
  town({ type: "test_grant", to: "ada", stacks: { stone: 2, clay: 7, sea_glass: 1, wood: 1 } }),
  ada({ type: "place", x: 4, y: 4, block: "kiln" }),
  ada({ type: "craft", recipe: "bowl", x: 4, y: 4, glaze: "moss", label: "Moss bowl" }),
  town({ type: "new_day", day: 20059 }),
  ada({ type: "harvest", x: 4, y: 4, roll: 1600 }),
  ada({ type: "craft", recipe: "vase", x: 4, y: 4 }),
  town({ type: "new_day", day: 20060 }),
  ada({ type: "harvest", x: 4, y: 4, roll: 42 }),
  ada({ type: "craft", recipe: "teapot", x: 4, y: 4, glaze: "sea" }),
  town({ type: "new_day", day: 20061 }),
  ada({ type: "harvest", x: 4, y: 4, roll: 9999 }),
  ada({ type: "give", item: "i_5", to: "bob" }),
  ada({ type: "list_item", item: "i_6", price: 15 }),
  ada({ type: "place", x: 3, y: 2, block: "pedestal" }),
  ada({ type: "display", item: "i_7", x: 3, y: 2 }),
];

/**
 * `hashWorld(replay(KILN_CONFIG, KILN_LOG))`. A finish's name is in the hash, so renaming one
 * moves it (decision 0367); no live world has logged `open_clay`.
 */
export const KILN_HASH = "91280811";
