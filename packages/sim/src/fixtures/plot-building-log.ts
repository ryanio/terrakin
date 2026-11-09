import type { Input, WorldConfig } from "../types";
import { TOWN_ACTOR } from "../types";

/**
 * Building on your own plot once building reaches the whole plot and walls go only on lines
 * (`plot-building.ts`). Ada settles plot (0, 0), builds her starter hut from lines, and puts a wood
 * wall block on a tile beside her hearth. The town logs `plot_reach`, and she sets a bench down in
 * the plot's far corner, 4 tiles away. The town logs `walls_on_lines`, and she takes the wall block
 * down and puts a wood wall on the line north of that tile instead. `plot-building.test.ts` replays
 * it to the hash pinned below, and `replay.test.ts` checks every split point.
 */
export const PLOT_BUILDING_CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const ada = (command: Input["command"]): Input => ({ actor: "ada", command });
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const PLOT_BUILDING_LOG: Input[] = [
  town({ type: "new_day", day: 20_000 }),
  town({ type: "open_items" }),
  town({ type: "starter_edges" }),
  ada({ type: "join", name: "ada", kind: "human" }),
  ada({ type: "settle", px: 0, py: 0 }),
  ada({ type: "build_starter_home" }),
  ada({ type: "place", x: 2, y: 2, block: "wood" }),
  town({ type: "plot_reach" }),
  town({ type: "test_grant", to: "ada", stacks: { bench: 1 } }),
  ada({ type: "place", x: 7, y: 7, block: "bench" }),
  town({ type: "walls_on_lines" }),
  ada({ type: "remove", x: 2, y: 2 }),
  ada({ type: "place", x: 2, y: 2, side: "n", block: "wood" }),
];

/** `hashWorld(replay(PLOT_BUILDING_CONFIG, PLOT_BUILDING_LOG))`, pinned so a change to how it replays fails. */
export const PLOT_BUILDING_HASH = "72a8af05";
