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
import type { Command, ItemsState, ResidentId, WorldConfig, WorldEvent, WorldState } from "./types";

/**
 * Simple gathering (phase 1, item 9; decision 0063): fallen branches in forests and loose stones
 * on stone ground. Each tile grows at most one pickup back a UTC day; `gather {x, y}` picks it up
 * into the gatherer's inventory. No coins move: the most grindable thing in phase 1 is a walk.
 *
 * The spawn is a pure function of the tile and the day, like `biomeAt`, so every client draws the
 * same sticks and stones without the log carrying them. Only the day's pickups live in state
 * (`items.gathered`, tile to day), and `new_day` forgets yesterday's, so old logs replay to the
 * hash they always had.
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

/** Whether the pickup on a tile is still lying there today. */
export function pickupLeft(state: WorldState, x: number, y: number): ResourceKind | null {
  const day = state.day;
  if (day === undefined) return null;
  const kind = gatherableAt(state.config, x, y, day);
  if (!kind) return null;
  if (state.blocks[tileKey(x, y)] !== undefined) return null;
  if (state.items?.gathered?.[tileKey(x, y)] === day) return null;
  return kind;
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
