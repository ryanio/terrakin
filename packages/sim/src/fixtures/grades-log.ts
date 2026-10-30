import type { Input, PlanEdge } from "../types";
import { TOWN_ACTOR } from "../types";
import { MARKET_CONFIG, MARKET_LOG } from "./market-log";

/**
 * The market world once made materials come in grades (RFC 0051). Before `open_grades` Ada makes
 * plain plaster at her workbench as anyone always could. Once the town logs it she makes fine
 * plaster: her first fine craft comes out masterwork from its roll, the next fifteen come out
 * fine, and the one after comes out masterwork from the floor whatever its roll. She swaps her
 * hut's wood walls for fine plaster in one build, slims them into fine plaster walls between
 * tiles (the town's gift is fine plaster too), roofs it in fine plaster, places and takes back up a
 * masterwork block, gives Dee masterwork plaster, and sells Bob a lot of fine plaster.
 * `grades.test.ts` checks the hash pinned below, so a change to a fine recipe, the roll, the floor,
 * or how a grade moves that would replay a real log differently fails loudly.
 */
export const GRADES_CONFIG = MARKET_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

/** A fine plaster craft at Ada's workbench, with the server's roll. */
const fine = (roll: number) =>
  ada({ type: "craft", recipe: "plaster", x: 4, y: 3, grade: "fine", roll });

/** Ada's starter hut's wood walls, in plot tiles: the ring at 1 to 5 less its two windows. */
const WOOD: [number, number][] = [
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 1],
  [1, 2],
  [5, 2],
  [1, 4],
  [5, 4],
  [1, 5],
  [2, 5],
  [4, 5],
  [5, 5],
];

/** The slim of that hut: its wall blocks up, and lines round its 25 tiles, fine where it was. */
const SLIM = {
  remove: [...WOOD, [1, 3] as [number, number], [5, 3] as [number, number]].map(([x, y]) => ({
    x,
    y,
  })),
  edges: [
    { x: 1, y: 1, side: "n", block: "plaster", grade: "fine" },
    { x: 1, y: 1, side: "w", block: "plaster", grade: "fine" },
    { x: 2, y: 1, side: "n", block: "plaster", grade: "fine" },
    { x: 3, y: 1, side: "n", block: "plaster", grade: "fine" },
    { x: 1, y: 2, side: "w", block: "plaster", grade: "fine" },
    { x: 1, y: 3, side: "w", block: "glass" },
    { x: 4, y: 1, side: "n", block: "plaster", grade: "fine" },
    { x: 5, y: 1, side: "n", block: "plaster", grade: "fine" },
    { x: 5, y: 1, side: "e", block: "plaster", grade: "fine" },
    { x: 5, y: 2, side: "e", block: "plaster", grade: "fine" },
    { x: 5, y: 3, side: "e", block: "glass" },
    { x: 1, y: 4, side: "w", block: "plaster", grade: "fine" },
    { x: 5, y: 4, side: "e", block: "plaster", grade: "fine" },
    { x: 1, y: 5, side: "s", block: "plaster", grade: "fine" },
    { x: 1, y: 5, side: "w", block: "plaster", grade: "fine" },
    { x: 2, y: 5, side: "s", block: "plaster", grade: "fine" },
    { x: 3, y: 5, side: "s", block: "door" },
    { x: 4, y: 5, side: "s", block: "plaster", grade: "fine" },
    { x: 5, y: 5, side: "e", block: "plaster", grade: "fine" },
    { x: 5, y: 5, side: "s", block: "plaster", grade: "fine" },
  ] satisfies PlanEdge[],
};

export const GRADES_LOG: Input[] = [
  ...MARKET_LOG,
  town({ type: "test_grant", to: "ada", stacks: { stone: 36, seashell: 17 } }),
  // Before the switch: plain plaster, as it always was.
  ada({ type: "craft", recipe: "plaster", x: 4, y: 3 }),
  town({ type: "open_grades" }),
  // Masterwork from the roll, then fifteen fine in a row, then masterwork from the floor.
  fine(300),
  ...Array.from({ length: 15 }, () => fine(9999)),
  fine(9999),
  // Thirteen wood walls out, thirteen of fine plaster in, in one plan.
  ada({
    type: "build",
    px: 0,
    py: 0,
    remove: WOOD.map(([x, y]) => ({ x, y })),
    blocks: WOOD.map(([x, y]) => ({ x, y, block: "plaster", grade: "fine" })),
  }),
  ada({ type: "slim_walls", px: 0, py: 0, ...SLIM }),
  ada({ type: "set_roof", px: 0, py: 0, style: "gable", material: "plaster", grade: "fine" }),
  ada({ type: "place", x: 3, y: 2, block: "plaster", grade: "masterwork" }),
  ada({ type: "remove", x: 3, y: 2 }),
  ada({ type: "give", item: "plaster", count: 2, grade: "masterwork", to: "dee" }),
  ada({ type: "list_item", item: "plaster", count: 2, grade: "fine", price: 10 }),
  { actor: "bob", command: { type: "buy_listing", listing: "l_3" } },
];

/** `hashWorld(replay(GRADES_CONFIG, GRADES_LOG))`, pinned when grades landed. */
export const GRADES_HASH = "8f1749e8";
