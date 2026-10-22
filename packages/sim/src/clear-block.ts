import { refuse } from "./check";
import { displayRemoveProblem } from "./display";
import { removeProblem } from "./floors";
import { blockRemoveProblem, cropAt, moveBlockCost } from "./items";
import { tileKey } from "./keys";
import { plotListedProblem } from "./plot-market";
import { kilnRemoveProblem } from "./pottery";
import type { Command, Rejection, WorldEvent, WorldState } from "./types";
import { TOWN_ACTOR } from "./types";
import { inBounds, plotAtTile } from "./world";

type Mutation = () => WorldEvent[];

/**
 * `clear_block {x, y}`, which only TOWN_ACTOR sends: staff took one block off the ground floor of a
 * claimed plot (decision 0343), to open a way out of a home nobody can walk out of. It goes back
 * to the plot's owner as if they had taken it up themselves: what a held block, a pond, or stairs
 * took comes back to their things, and a free block gives nothing back. It is refused exactly where
 * the owner's own `remove` would be, so staff can never leave a plot in a state its owner couldn't:
 * a planter with something growing, a kiln firing a pot, a block under a display, a wall that holds up an upstairs, or
 * an owner with no room for what comes back. Whether the way is open afterwards is the server's
 * question, not this rule's.
 */
export function checkClearBlock(
  state: WorldState,
  command: Extract<Command, { type: "clear_block" }>,
): Mutation | Rejection {
  const { x, y } = command;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(state.config, x, y)) {
    return refuse("out_of_bounds", "That's outside the world.");
  }
  const plot = plotAtTile(state, x, y);
  if (!plot) return refuse("no_plot", "That tile isn't on a claimed plot.");
  // Staff take a plot off the market first: a buyer pays for the plot as it stands.
  const listed = plotListedProblem(state, plot.px, plot.py);
  if (listed) return listed;
  const key = tileKey(x, y);
  const taken = state.blocks[key];
  if (taken === undefined) return refuse("no_block", "Nothing to remove there.");
  if (cropAt(state, x, y)) {
    return refuse("tile_occupied", "Something is growing in that planter. Pick another block.");
  }
  const shown = displayRemoveProblem(state, x, y);
  if (shown) return shown;
  // A kiln firing a pot (RFC 0047) stays until the pot is out, as for its owner.
  const firing = kilnRemoveProblem(state, x, y);
  if (firing) return firing;
  const holding = removeProblem(state, x, y, 0);
  if (holding) return holding;
  const owner = plot.ownerId;
  const full = blockRemoveProblem(state, owner, taken);
  if (full)
    return refuse("inventory_full", "The plot's owner has no room for what that block gives back.");
  return () => {
    delete state.blocks[key];
    return [
      { type: "block_removed", x, y, by: TOWN_ACTOR },
      ...moveBlockCost(state, owner, taken, 1),
    ];
  };
}
