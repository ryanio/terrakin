import {
  type AuthorView,
  type BuyOrderView,
  SHOP_ITEMS,
  SHOP_RULES,
  type ShopResponse,
} from "@terrakin/protocol";
import {
  BUY_ORDERS,
  coinsOf,
  ITEM_INFO,
  isTownsfolk,
  shopFor,
  shopTiles,
  townBuys,
  type WorldState,
} from "@terrakin/sim";

/**
 * The town shop (RFC 0008, phase 2) as the API shows it. The sim keeps the catalog, the buy
 * orders, and what each resident sold today; this adds names and the shopkeeper.
 */

/** The townsfolk handle of the shopkeeper: Clem, who already runs the cafe. */
export const SHOP_KEEPER_HANDLE = "clem";

/** What the town buys today, and with a viewer, how many more of each they can sell. */
export function buyingToday(state: WorldState, viewer?: string): BuyOrderView[] {
  if (!state.shop || state.day === undefined) return [];
  const sold = viewer ? shopFor(state, viewer)?.sold : undefined;
  return townBuys(state.day).map((kind) => {
    const order = BUY_ORDERS[kind];
    return {
      kind,
      name: ITEM_INFO[kind].plural,
      price: order.price,
      perDay: order.perDay,
      ...(sold ? { left: order.perDay - (sold[kind] ?? 0) } : {}),
    };
  });
}

/** The shop on `GET /v1/town`: where it stands and today's buying, or null before it opens. */
export function townShopView(
  state: WorldState,
): { tiles: { x: number; y: number }[]; buying: BuyOrderView[] } | null {
  if (!state.shop) return null;
  return { tiles: shopTiles(state.config), buying: buyingToday(state) };
}

/**
 * `GET /v1/shop`. `keeperId` is whoever holds the keeper's handle; they're shown only while
 * they're townsfolk, so a resident who somehow held the handle couldn't pose as the shopkeeper.
 */
export function shopView(
  state: WorldState,
  viewer: string | undefined,
  keeperId: string | undefined,
  author: (id: string) => AuthorView | undefined,
): ShopResponse {
  const rules = { ...SHOP_RULES };
  if (!state.shop || state.day === undefined) return { shop: null, you: null, rules };
  const keeper = keeperId && isTownsfolk(state, keeperId) ? (author(keeperId) ?? null) : null;
  const mine = viewer && state.residents[viewer] ? shopFor(state, viewer) : null;
  return {
    shop: {
      day: state.day,
      keeper,
      items: SHOP_ITEMS,
      buying: buyingToday(state, mine ? viewer : undefined),
      tiles: shopTiles(state.config),
    },
    you: mine && viewer ? { balance: coinsOf(state, viewer), wardrobe: mine.wardrobe } : null,
    rules,
  };
}
