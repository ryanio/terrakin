import { refuse } from "./check";
import {
  addStack,
  closed,
  countOf,
  GATHER_HINT,
  held,
  ITEMS,
  type ItemsChecked,
  inventory,
  inventoryEvent,
  inventorySize,
  isResourceKind,
  type StackKind,
} from "./items";
import { tileKey } from "./keys";
import type { Command, ItemsState, ResidentId, WorldEvent, WorldState } from "./types";

/**
 * Paths and floors (RFC 0016): a second layer under the blocks. Each tile can hold one ground kind,
 * in `state.ground`, absent until the first one is laid. Ground never changes where anyone can
 * walk: only blocks do. It can go under a block, under a hearth, and under someone standing there.
 *
 * `lay` and `lift` keep `place`'s rules for where (your own plot or one shared with you, within
 * reach), checked in `apply.ts`; this file checks the ground itself. A kind with a cost takes it
 * from your things when it's laid and gives it back to whoever lifts it, like decor. Free kinds
 * touch nobody's things.
 */

/** Every path and floor, free ones first. New kinds go on the end. */
export const GROUND_KINDS = [
  "dirt",
  "sand",
  "moss",
  "leaves",
  "cobble",
  "stepping_stones",
  "brick",
  "planks",
  "flower_bed",
  "rug",
] as const;
export type GroundKind = (typeof GROUND_KINDS)[number];

export const isGroundKind = (k: unknown): k is GroundKind =>
  typeof k === "string" && (GROUND_KINDS as readonly string[]).includes(k);

export interface GroundInfo {
  /** One tile of it, in plain words. */
  name: string;
  /** What one tile takes from your things. Empty for a free kind. */
  needs: Partial<Record<StackKind, number>>;
}

/** The numbers. Decision 0075 has the reasoning. */
export const GROUND_INFO: Readonly<Record<GroundKind, GroundInfo>> = {
  dirt: { name: "Dirt path", needs: {} },
  sand: { name: "Sand", needs: {} },
  moss: { name: "Moss", needs: {} },
  leaves: { name: "Fallen leaves", needs: {} },
  cobble: { name: "Cobblestones", needs: { stone: 1 } },
  stepping_stones: { name: "Stepping stones", needs: { stone: 1 } },
  brick: { name: "Brick path", needs: { stone: 2 } },
  planks: { name: "Plank floor", needs: { wood: 1 } },
  flower_bed: { name: "Flower bed", needs: { flower: 1 } },
  rug: { name: "Rug", needs: { herb: 1, flower: 1 } },
};

/** What one tile of a kind takes, in a fixed order. Empty for a free kind. */
export function groundNeeds(kind: GroundKind): [StackKind, number][] {
  return Object.entries(GROUND_INFO[kind].needs) as [StackKind, number][];
}

/** The ground on a tile, if any. */
export const groundAt = (state: WorldState, x: number, y: number): GroundKind | undefined =>
  state.ground?.[tileKey(x, y)];

/**
 * What you'd still need to lay `tiles` tiles of a kind, from what you hold: empty when you have
 * enough. Pure, so clients ask it the same question `lay` does (decision 0052).
 */
export function groundShort(
  kind: GroundKind,
  have: (kind: StackKind) => number,
  tiles = 1,
): { kind: StackKind; count: number }[] {
  return groundNeeds(kind).flatMap(([need, n]) => {
    const missing = n * tiles - have(need);
    return missing > 0 ? [{ kind: need, count: missing }] : [];
  });
}

/** Where to get what a refusal says is missing. */
function sourceHint(kinds: readonly StackKind[]): string {
  const hints: string[] = [];
  if (kinds.some((k) => isResourceKind(k))) hints.push(GATHER_HINT);
  if (kinds.some((k) => k === "flower" || k === "herb")) {
    hints.push("Flowers and herbs grow in a planter: plant, then harvest.");
  }
  return hints.length > 0 ? ` ${hints.join(" ")}` : "";
}

/** "1 stone", or "1 bunch of herbs and 1 flower". */
const needsWords = (needs: [StackKind, number][]) =>
  needs.map(([kind, n]) => countOf(kind, n)).join(" and ");

/** `lay {x, y, ground}`, once `apply.ts` has checked the tile is in reach and buildable. */
export function checkLay(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "lay" }>,
): ItemsChecked {
  const { x, y, ground } = command;
  if (!isGroundKind(ground)) {
    return refuse("unknown_item", `Lay one of: ${GROUND_KINDS.join(", ")}.`);
  }
  const key = tileKey(x, y);
  const there = state.ground?.[key];
  if (there !== undefined) {
    const what = GROUND_INFO[there].name.toLowerCase();
    return refuse(
      "tile_occupied",
      there === ground
        ? `That tile is already ${what}.`
        : `That tile already has ${what}. Lift it first with lift.`,
    );
  }
  const needs = groundNeeds(ground);
  let items: ItemsState | undefined;
  if (needs.length > 0) {
    const shut = closed(state);
    if (shut) return shut;
    items = state.items as ItemsState;
    const inv = items.inventories[actor];
    const short = groundShort(ground, (kind) => held(inv, kind));
    if (short.length > 0) {
      return refuse(
        "not_enough_items",
        `${GROUND_INFO[ground].name} takes ${needsWords(needs)} a tile, and you need ${short.map((s) => countOf(s.kind, s.count)).join(" and ")} more.${sourceHint(short.map((s) => s.kind))}`,
      );
    }
  }
  return () => {
    state.ground ??= {};
    state.ground[key] = ground;
    const events: WorldEvent[] = [{ type: "ground_laid", x, y, ground, by: actor }];
    if (items) {
      const mine = inventory(items, actor);
      const changes = needs.map(([kind, n]) => addStack(mine, kind, -n));
      events.push(inventoryEvent(actor, "laid", changes));
    }
    return events;
  };
}

/** `lift {x, y}`, once `apply.ts` has checked the tile is in reach and buildable. */
export function checkLift(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "lift" }>,
): ItemsChecked {
  const { x, y } = command;
  const key = tileKey(x, y);
  const there = state.ground?.[key];
  if (there === undefined) {
    return refuse("no_ground", "There's no path or floor there to lift.");
  }
  const needs = groundNeeds(there);
  let items: ItemsState | undefined;
  if (needs.length > 0) {
    const shut = closed(state);
    if (shut) return shut;
    items = state.items as ItemsState;
    const back = needs.reduce((sum, [, n]) => sum + n, 0);
    if (inventorySize(items.inventories[actor]) + back > ITEMS.inventoryMax) {
      return refuse(
        "inventory_full",
        `You can hold ${ITEMS.inventoryMax} things, and lifting this gives back ${needsWords(needs)}. Make, place, or give something first.`,
      );
    }
  }
  const ground = state.ground as Record<string, GroundKind>;
  return () => {
    delete ground[key];
    const events: WorldEvent[] = [{ type: "ground_lifted", x, y, by: actor }];
    if (items) {
      const mine = inventory(items, actor);
      const changes = needs.map(([kind, n]) => addStack(mine, kind, n));
      events.push(inventoryEvent(actor, "lifted", changes));
    }
    return events;
  };
}

/** What one tile of a kind takes, in words: "1 stone", "1 bunch of herbs and 1 flower", "free". */
export function groundCostWords(kind: GroundKind): string {
  const needs = groundNeeds(kind);
  return needs.length === 0 ? "free" : needsWords(needs);
}
