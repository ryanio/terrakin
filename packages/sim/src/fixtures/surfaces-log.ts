import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { COZY_CONFIG, COZY_LOG } from "./cozy-log";

/**
 * The cozy world after homes get roomier (RFC 0050). Dee, just out of her hut's door at (11, 6) on
 * plot (1, 0), is handed a table, two candles, a wall clock and a mirror. She sets the table at
 * (10, 3) beside the hearth, puts a candle on it, hangs the clock on the west wall and the mirror
 * on the south wall, both seen from (10, 4), then takes the mirror down again. `surfaces.test.ts`
 * replays it and checks the hash pinned below, so a change to how a surface or a wall holds a
 * thing that would replay a real log differently fails loudly. Every older fixture hashes as
 * before, because no log before this one named `put_on`, `hang`, or a trinket.
 */
export const SURFACES_CONFIG = COZY_CONFIG;

const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const SURFACES_LOG: Input[] = [
  ...COZY_LOG,
  town({
    type: "test_grant",
    to: "dee",
    stacks: { table: 1, candle: 2, wall_clock: 1, mirror: 1 },
  }),
  dee({ type: "place", x: 10, y: 3, block: "table" }),
  dee({ type: "put_on", x: 10, y: 3, item: "candle" }),
  dee({ type: "hang", x: 10, y: 4, side: "w", item: "wall_clock" }),
  dee({ type: "hang", x: 10, y: 4, side: "s", item: "mirror" }),
  dee({ type: "unhang", x: 10, y: 4, side: "s" }),
];

/** `hashWorld(replay(SURFACES_CONFIG, SURFACES_LOG))`, pinned so a change to how this log replays fails. */
export const SURFACES_HASH = "e88e5b62";
