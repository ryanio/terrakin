import {
  type AuthorView,
  type GardenView,
  type InventoryResponse,
  ITEM_CATALOG,
  ITEM_RULES,
} from "@terrakin/protocol";
import {
  canBuildOn,
  inventoryOf,
  isReady,
  parseKey,
  plotAtTile,
  type WorldState,
} from "@terrakin/sim";

/**
 * Growing, making, and giving (RFC 0005) as the API shows them. The sim keeps the inventories;
 * this adds names. An inventory is private to its owner, like a purse.
 */

type Authors = (id: string) => AuthorView | undefined;

/** Crops on plots `viewer` can build on (theirs, or shared with them), soonest ready first. */
export function gardenOf(state: WorldState, viewer: string): GardenView[] {
  const crops = state.items?.crops ?? {};
  const out: GardenView[] = [];
  for (const [key, c] of Object.entries(crops)) {
    const [x, y] = parseKey(key);
    if (!canBuildOn(plotAtTile(state, x, y), viewer)) continue;
    out.push({
      x,
      y,
      crop: c.crop,
      plantedDay: c.plantedDay,
      readyDay: c.readyDay,
      ready: isReady(c.readyDay, state.day),
    });
  }
  return out.sort((a, b) => a.readyDay - b.readyDay || a.y - b.y || a.x - b.x);
}

/** `GET /v1/inventory`: the viewer's own things, their garden, the rules, and the catalog. */
export function inventoryView(
  state: WorldState,
  viewer: string,
  author: Authors,
): InventoryResponse {
  const read = inventoryOf(state, viewer);
  const base = { rules: { ...ITEM_RULES }, catalog: ITEM_CATALOG };
  if (!read) return { inventory: null, ...base };
  return {
    inventory: {
      day: state.day ?? 0,
      stacks: read.stacks,
      goods: read.goods.map((g) => {
        const maker = author(g.maker);
        return {
          id: g.id,
          kind: g.kind,
          ...(maker ? { maker } : {}),
          makerId: g.maker,
          madeDay: g.madeDay,
          ...(g.label === undefined ? {} : { label: g.label }),
          trust: "untrusted" as const,
        };
      }),
      size: read.size,
      pantryToday: read.pantryToday,
      hasHearth: state.residents[viewer]?.hearth != null,
      givenToday: read.givenToday,
      receivedToday: read.receivedToday,
      craftedToday: read.craftedToday,
      garden: gardenOf(state, viewer),
    },
    ...base,
  };
}
