import { biomeAt } from "./biome";
import { refuse } from "./check";
import {
  addStack,
  closed,
  ITEMS,
  type ItemsChecked,
  inventory,
  inventoryEvent,
  inventorySize,
  type ResourceKind,
  reachProblem,
} from "./items";
import { tileKey } from "./keys";
import type {
  Command,
  ItemsState,
  Plot,
  ResidentId,
  Tile,
  WorldConfig,
  WorldEvent,
  WorldState,
} from "./types";
import { canBuildOn, inBounds, plotAtTile } from "./world";

/**
 * Simple gathering (phase 1, item 9; decision 0063): fallen branches in forests and loose stones
 * on stone ground. Each tile grows at most one pickup back a UTC day; `gather {x, y}` picks it up
 * into the gatherer's inventory. No coins move: the most grindable thing in phase 1 is a walk.
 *
 * The spawn is a pure function of the tile and the day, like `biomeAt`, so every client draws the
 * same sticks and stones without the log carrying them. Only the day's pickups live in state
 * (`items.gathered`, tile to day), and `new_day` forgets yesterday's, so old logs replay to the
 * hash they always had.
 *
 * Once the server logs `own_plot_pickups`, a claimed plot's pickups are for its owner and
 * co-owners only. The Commons and unclaimed land stay open to everyone. Gathers logged before the
 * switch replay as they were made.
 */

/** The numbers. Every count is a whole number of pickups. */
export const GATHER = {
  /** Chance a forest tile drops a fallen branch on a day. */
  woodChance: 0.08,
  /** Chance a stone-ground tile drops a loose stone on a day. */
  stoneChance: 0.08,
  /** What one pickup puts in your things. */
  perPickup: 1,
} as const;

/**
 * What lies on tile (x, y) on `day`, if anything: a fallen branch in a forest, a loose stone on
 * stone ground. Pure: the same tile and day always answer the same, on every client and replay.
 */
export function gatherableAt(
  config: WorldConfig,
  x: number,
  y: number,
  day: number,
): ResourceKind | null {
  const biome = biomeAt(config, x, y);
  const kind: ResourceKind | null =
    biome === "forest" ? "wood" : biome === "stone" ? "stone" : null;
  if (!kind) return null;
  // Mix the three integers with a finalizer, like biomeAt, so neighboring tiles and days are
  // independent.
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(day, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const roll = ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  const chance = kind === "wood" ? GATHER.woodChance : GATHER.stoneChance;
  return roll < chance ? kind : null;
}

/**
 * What still lies on (x, y) on `day`: its spawn, unless the tile is built on or was picked clean
 * today. Pure, so a client draws exactly what `gather` would take from its own copy of the world.
 */
export function pickupOn(
  config: WorldConfig,
  x: number,
  y: number,
  day: number,
  tile: { built: boolean; picked: boolean },
): ResourceKind | null {
  if (tile.built || tile.picked) return null;
  return gatherableAt(config, x, y, day);
}

/** Whether the pickup on a tile is still lying there today. */
export function pickupLeft(state: WorldState, x: number, y: number): ResourceKind | null {
  const day = state.day;
  if (day === undefined) return null;
  const key = tileKey(x, y);
  return pickupOn(state.config, x, y, day, {
    built: state.blocks[key] !== undefined,
    picked: state.items?.gathered?.[key] === day,
  });
}

/**
 * Whether a resident may gather on a tile of `plot` (undefined for the Commons and unclaimed
 * land). Pure, so clients ask it the same question the sim does: with `ownersOnly` off (before
 * `own_plot_pickups`), anyone may gather anywhere.
 */
export function mayGatherOn(
  plot: Pick<Plot, "ownerId" | "coOwners"> | undefined,
  residentId: ResidentId,
  ownersOnly: boolean,
): boolean {
  return !ownersOnly || !plot || canBuildOn(plot, residentId);
}

/** Whether the owners-only rule is on in this world (`own_plot_pickups` was logged). */
export function plotPickupsOwned(state: WorldState): boolean {
  return state.items?.plotPickupsOwned === true;
}

/**
 * The words in every refusal of a gather on someone else's plot, so clients can tell it from a
 * build refusal with the same code and say it their own way.
 */
export const OTHERS_PLOT_GATHER =
  "only its owner and the people they share it with can gather there";

/** How far around a refused gather the hint looks for one the resident may take. */
const HINT_RADIUS = 12;

/**
 * The nearest pickup lying today that `actor` may take, within `HINT_RADIUS` of `from`: nearest by
 * Chebyshev distance, then north to south, then west to east. For a refusal's next step only.
 */
function nearestOpenPickup(state: WorldState, actor: ResidentId, from: Tile): Tile | null {
  const ownersOnly = plotPickupsOwned(state);
  for (let d = 0; d <= HINT_RADIUS; d++) {
    for (let y = from.y - d; y <= from.y + d; y++) {
      for (let x = from.x - d; x <= from.x + d; x++) {
        if (Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) !== d) continue;
        if (!inBounds(state.config, x, y) || !pickupLeft(state, x, y)) continue;
        if (mayGatherOn(plotAtTile(state, x, y), actor, ownersOnly)) return { x, y };
      }
    }
  }
  return null;
}

/** `gather {x, y}`: pick up the fallen branch or loose stone on a tile within reach. */
export function checkGather(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "gather" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const me = state.residents[actor];
  if (!me) return refuse("not_joined", "Join the world first.");
  const { x, y } = command;
  const far = reachProblem(state, me, { x, y });
  if (far) return far;
  const kind = pickupLeft(state, x, y);
  if (!kind) {
    return refuse(
      "nothing_to_gather",
      "Nothing to pick up there. Fallen branches lie in forests, loose stones on stone ground, and each tile grows one back a day.",
    );
  }
  const plot = plotAtTile(state, x, y);
  if (!mayGatherOn(plot, actor, plotPickupsOwned(state))) {
    const near = nearestOpenPickup(state, actor, me);
    const hint = near ? ` The nearest one you may take is at x ${near.x}, y ${near.y}.` : "";
    return refuse(
      "not_your_plot",
      `That's ${plot?.ownerId}'s plot: ${OTHERS_PLOT_GATHER}. The Commons and unclaimed land are free to gather, and so is your own plot.${hint}`,
    );
  }
  if (inventorySize(items.inventories[actor]) + GATHER.perPickup > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things. Make or give something first.`,
    );
  }
  const key = tileKey(x, y);
  return () => {
    if (!items.gathered) items.gathered = {};
    items.gathered[key] = day;
    const change = addStack(inventory(items, actor), kind, GATHER.perPickup);
    const events: WorldEvent[] = [
      { type: "gathered", x, y, kind, by: actor },
      inventoryEvent(actor, "gather", [change]),
    ];
    return events;
  };
}

/** `own_plot_pickups`, which only TOWN_ACTOR sends: from now on, a plot's pickups are its owners'. */
export function checkOwnPlotPickups(state: WorldState): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  if (items.plotPickupsOwned) {
    return refuse("already_open", "Pickups on a plot are already for its owners only.");
  }
  return () => {
    items.plotPickupsOwned = true;
    return [{ type: "plot_pickups_owned" }];
  };
}
