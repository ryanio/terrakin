import type { Input, WorldConfig } from "../types";
import { TOWN_ACTOR } from "../types";

/**
 * A lot grown once (RFC 0052). Ada settles plot (0, 0) of a world with coins, builds her starter
 * hut, and the town regrids: her hut stands in the middle of a 16-tile slot, her lot tiles 4 to 11.
 * She sets six armchairs down in the hut, is handed the coins, grows the lot to 10 (tiles 3 to 12),
 * and lays a path in the ring it gained. `lots.test.ts` replays it to the hash pinned below, and
 * `replay.test.ts` checks every split point, so a change to what a step asks, what `furnishing`
 * counts, or how a lot grows fails loudly.
 */
export const LOTS_CONFIG: WorldConfig = {
  width: 48,
  height: 48,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const ada = (command: Input["command"]): Input => ({ actor: "ada", command });
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const LOTS_LOG: Input[] = [
  town({ type: "new_day", day: 20_000 }),
  town({ type: "open_economy" }),
  town({ type: "open_items" }),
  town({ type: "starter_edges" }),
  town({ type: "plot_reach" }),
  ada({ type: "join", name: "ada", kind: "human" }),
  ada({ type: "settle", px: 0, py: 0 }),
  ada({ type: "build_starter_home" }),
  town({ type: "regrid" }),
  town({ type: "test_grant", to: "ada", coins: 150, stacks: { armchair: 6 } }),
  ...[6, 7, 8, 9].map((x) => ada({ type: "place", x, y: 6, block: "armchair" })),
  ada({ type: "place", x: 6, y: 8, block: "armchair" }),
  ada({ type: "place", x: 8, y: 8, block: "armchair" }),
  ada({ type: "grow_lot", px: 0, py: 0 }),
  ada({ type: "lay", x: 3, y: 6, ground: "dirt" }),
];

/** `hashWorld(replay(LOTS_CONFIG, LOTS_LOG))`, pinned so a change to how it replays fails. */
export const LOTS_HASH = "c798800d";
