import { oneTimeSwitch } from "./check";
import { tileKey } from "./keys";
import type { Rejection, Tile, WorldEvent, WorldState } from "./types";
import { blocksWalkers, inBounds } from "./world";

/**
 * Doors you build (decision 0349): the `door` block, free and on the ground floor only, drawn as a
 * wall with a door in it and walked through like an open tile (`blocksWalkers` in `world.ts`).
 * Not the doors of `doors.ts`, which are the tiles in front of the Town Hall and the shop counters
 * where an action needs you to stand. A door has no lock: a lock, if one ever comes, opens for
 * everyone the plot's owner allows and never counts against a plot's way in.
 */

/**
 * `starter_doors`, which only TOWN_ACTOR sends: from now on `build_starter_home` hangs a door in
 * the hut's doorway. Starter homes built before it replay with the open doorway they were built
 * with, and homes already standing are never changed. Comes once.
 */
export function checkStarterDoors(state: WorldState): (() => WorldEvent[]) | Rejection {
  return oneTimeSwitch({
    on: state.starterDoors,
    already: "Starter homes already have a door.",
    turnOn: () => {
      state.starterDoors = true;
    },
    event: { type: "starter_doors_set" },
  });
}

/**
 * The first doorway with no door on plot (`px`, `py`)'s ground floor, north to south then west to
 * east, or undefined: an open tile on the plot, nobody's hearth, with a block that stops walkers
 * on two opposite sides and none on the other two, which is a gap in a wall. Undefined too when
 * the plot already has a door anywhere, since then it has a way in that shows. The check-in reads
 * it to suggest a door; no rule does.
 */
export function doorwayWithoutDoor(state: WorldState, px: number, py: number): Tile | undefined {
  const S = state.config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const at = (x: number, y: number) => state.blocks[tileKey(x, y)];
  for (let y = y0; y < y0 + S; y++) {
    for (let x = x0; x < x0 + S; x++) if (at(x, y) === "door") return undefined;
  }
  const hearths = new Set(
    Object.values(state.residents).flatMap((r) =>
      r.hearth ? [tileKey(r.hearth.x, r.hearth.y)] : [],
    ),
  );
  const wall = (x: number, y: number) => blocksWalkers(at(x, y));
  for (let y = y0; y < y0 + S; y++) {
    for (let x = x0; x < x0 + S; x++) {
      if (!inBounds(state.config, x, y) || at(x, y) !== undefined) continue;
      if (hearths.has(tileKey(x, y))) continue;
      const across = wall(x - 1, y) && wall(x + 1, y) && !wall(x, y - 1) && !wall(x, y + 1);
      const along = wall(x, y - 1) && wall(x, y + 1) && !wall(x - 1, y) && !wall(x + 1, y);
      if (across || along) return { x, y };
    }
  }
  return undefined;
}
