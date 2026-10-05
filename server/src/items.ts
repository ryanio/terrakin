import {
  type AuthorView,
  type GardenView,
  type GoodView,
  type InventoryResponse,
  ITEM_CATALOG,
  ITEM_RULES,
} from "@terrakin/protocol";
import {
  canBuildOn,
  type Good,
  inventoryOf,
  isReady,
  lastDeclineDay,
  pantryNumbers,
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

/** A made thing as the API shows it, with its maker's name. Its label is untrusted text. */
export function goodView(g: Good, author: Authors): GoodView {
  const maker = author(g.maker);
  return {
    id: g.id,
    kind: g.kind,
    ...(maker ? { maker } : {}),
    makerId: g.maker,
    madeDay: g.madeDay,
    ...(g.label === undefined ? {} : { label: g.label }),
    ...(g.media === undefined ? {} : { media: g.media }),
    ...(g.model ? { model: true as const } : {}),
    ...(g.admired ? { admired: g.admired } : {}),
    trust: "untrusted",
  };
}

/** `GET /v1/inventory`: the viewer's own things, their garden, the rules, and the catalog. */
export function inventoryView(
  state: WorldState,
  viewer: string,
  author: Authors,
): InventoryResponse {
  const read = inventoryOf(state, viewer);
  // The pantry gives less once the town shop sells sugar and jars.
  const { pantry, stapleMax } = pantryNumbers(state);
  const rules = { ...ITEM_RULES, pantrySugar: pantry.sugar, pantryJars: pantry.jar, stapleMax };
  const base = { rules, catalog: ITEM_CATALOG };
  if (!read) return { inventory: null, ...base };
  return {
    inventory: {
      day: state.day ?? 0,
      stacks: read.stacks,
      goods: read.goods.map((g) => goodView(g, author)),
      size: read.size,
      pantryToday: read.pantryToday,
      hasHearth: state.residents[viewer]?.hearth != null,
      givenToday: read.givenToday,
      receivedToday: read.receivedToday,
      craftedToday: read.craftedToday,
      garden: gardenOf(state, viewer),
      gifts: read.gifts.map((g) => {
        const from = author(g.from);
        return {
          id: g.id,
          ...(from ? { from } : {}),
          fromId: g.from,
          kind: g.kind,
          count: g.count,
          ...(g.goods ? { goods: g.goods } : {}),
          day: g.day,
          lastDay: lastDeclineDay(g.day),
        };
      }),
    },
    ...base,
  };
}
