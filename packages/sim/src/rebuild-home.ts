import { checkBuild } from "./build";
import { refuse } from "./check";
import type { Command, Rejection, WorldEvent, WorldState } from "./types";

type Mutation = () => WorldEvent[];

/**
 * `rebuild_home {px, py, blocks, remove}`, which only TOWN_ACTOR sends: the town rebuilds a home a
 * way cut through, as a `build` by the plot's owner. It takes the same checks a build of theirs
 * would, including that no block lands on a way, and whatever it takes up goes to their things, so
 * the town can never leave a plot as its owner couldn't. Refused on a plot nobody owns.
 *
 * It builds from the owner's things, as their own `build` would. The server only ever plans walls
 * of wood, stone or a hedge and a door, which are free blocks and take nothing from anyone, so a
 * rebuild never spends what someone holds. A plan that put up a made material or decor would take
 * it from the owner's things, and is refused when they don't hold it: keep the planner to free
 * blocks (`rebuildOf` in `packages/server/src/way-plan.ts`).
 */
export function checkRebuildHome(
  state: WorldState,
  command: Extract<Command, { type: "rebuild_home" }>,
): Mutation | Rejection {
  const { px, py } = command;
  const plot =
    Number.isInteger(px) && Number.isInteger(py) ? state.plots[`${px},${py}`] : undefined;
  if (!plot) return refuse("plot_unclaimed", "Nobody owns that plot.");
  const built = checkBuild(state, plot.ownerId, {
    type: "build",
    px,
    py,
    blocks: command.blocks,
    remove: command.remove,
  });
  if ("code" in built) return built;
  if (built.plan.skipped.length > 0) {
    return refuse(
      "tile_occupied",
      "Part of the rebuild can't go where it's planned. Plan it again.",
    );
  }
  return () => [...built.commit(), { type: "home_rebuilt", px, py, ownerId: plot.ownerId }];
}
