import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { SURFACES_CONFIG, SURFACES_LOG } from "./surfaces-log";

/**
 * The surfaces world with walls between tiles (RFC 0050). Dee, out of her hut's door at (11, 6) on
 * plot (1, 0), puts a stone wall on the line east of her, hangs nothing on it, takes it down again,
 * then builds a short garden wall of two lines in one plan. The town turns `starter_edges` on.
 * `edges.test.ts` replays it and checks the hash pinned below, so a change to how a wall between
 * tiles is placed, walked past or built that would replay a real log differently fails loudly.
 * Every older fixture hashes as before, because no log before this one named a `side` or
 * `starter_edges`.
 */
export const EDGES_CONFIG = SURFACES_CONFIG;

const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const EDGES_LOG: Input[] = [
  ...SURFACES_LOG,
  dee({ type: "place", x: 11, y: 6, side: "e", block: "stone" }),
  dee({ type: "remove", x: 12, y: 6, side: "w" }),
  dee({
    type: "build",
    px: 1,
    py: 0,
    edges: [
      { x: 2, y: 7, side: "n", block: "wood" },
      { x: 3, y: 7, side: "n", block: "wood" },
    ],
  }),
  town({ type: "starter_edges" }),
];

/** `hashWorld(replay(EDGES_CONFIG, EDGES_LOG))`, pinned so a change to how this log replays fails. */
export const EDGES_HASH = "150b655f";
