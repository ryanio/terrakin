import {
  type AuthorView,
  type BuyOrderView,
  type RecipeCardView,
  SHOP_ITEMS,
  SHOP_RULES,
  type ShopItemView,
  type ShopResponse,
} from "@terrakin/protocol";
import {
  CARD_RECIPES,
  CATALOG,
  type CraftKind,
  cardLastDay,
  cardSeason,
  cardSku,
  coinsOf,
  holidayOn,
  ITEM_INFO,
  isTownsfolk,
  type KindRecipe,
  knows,
  onSale,
  onShelf,
  priceOf,
  recipeCardPrice,
  seasonLastDay,
  seasonOf,
  shopFor,
  shopOf,
  shopTiles,
  treasuryShareOf,
  type WorldState,
} from "@terrakin/sim";

/**
 * The town shop (RFC 0008, phase 2) as the API shows it. The sim keeps the catalog, the buy
 * orders, and what each resident sold today; this adds names and the shopkeeper.
 */

/** The townsfolk handle of the shopkeeper: Clem, who already runs the cafe. */
export const SHOP_KEEPER_HANDLE = "clem";

/**
 * What the town buys today, and with a viewer, how many more of each they can sell. A season's
 * buys come after the rotation's and carry their `season` (RFC 0017).
 */
function buyingToday(state: WorldState, viewer?: string): BuyOrderView[] {
  const shop = shopOf(state);
  if (!shop) return [];
  const sold = viewer ? shopFor(state, viewer)?.sold : undefined;
  return shop.buying.map(({ kind, price, perDay, season }) => ({
    kind,
    name: ITEM_INFO[kind].plural,
    price,
    perDay,
    ...(sold ? { left: perDay - (sold[kind] ?? 0) } : {}),
    ...(season ? { season } : {}),
  }));
}

/**
 * What the shop sells on `day`: everything sold all year, the season's own stock, and a holiday's
 * while it runs, each at this world's price and with the last day it's sold. Stock from other seasons and holidays isn't
 * listed (RFC 0017, RFC 0022).
 */
function itemsOn(state: WorldState, day: number): ShopItemView[] {
  const holiday = holidayOn(day);
  return SHOP_ITEMS.filter((item) => onSale(item.sku, day)).map((item) => {
    // What this world charges: holiday stock costs decision 0107's prices until the server logs
    // `lower_holiday_prices` (decision 0210).
    const priced = { ...item, price: priceOf(state, item.sku) };
    if (item.holiday && holiday) return { ...priced, lastDay: holiday.lastDay };
    return item.season ? { ...priced, lastDay: seasonLastDay(day) } : priced;
  });
}

/** Every recipe card (RFC 0024), in catalog order, as the shelf shows it, from the sim's data. */
const CARDS = CARD_RECIPES.map((recipe) => {
  const kind = recipe as CraftKind;
  // Every card is a recipe the catalog writes out, so its kind has one.
  const { station, needs } = CATALOG[kind].recipe as KindRecipe;
  const season = cardSeason(recipe);
  const view: RecipeCardView = {
    sku: cardSku(recipe),
    name: `${ITEM_INFO[kind].name} recipe`,
    price: recipeCardPrice(recipe),
    section: "recipes",
    recipe: {
      station,
      makes: kind,
      needs: Object.entries(needs).map(([need, count]) => ({
        kind: need as RecipeCardView["recipe"]["needs"][number]["kind"],
        count,
      })),
    },
    ...(season ? { season } : {}),
  };
  return { recipe, view };
});

/**
 * The Recipes shelf on `day` (RFC 0024), once recipes are learned in the world: every card, and
 * seasonal ones only in their season. With a viewer, each says whether they know it already.
 */
function cardsOn(state: WorldState, day: number, viewer: string | undefined): RecipeCardView[] {
  return CARDS.flatMap(({ recipe, view }) => {
    if (!onShelf(recipe, day)) return [];
    const lastDay = cardLastDay(recipe, day);
    return [
      {
        ...view,
        ...(lastDay === undefined ? {} : { lastDay }),
        ...(viewer ? { known: knows(state, viewer, recipe) } : {}),
      },
    ];
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
  // The share in force in this world, which `SHOP_RULES` can't know before the shop opens.
  const rules = { ...SHOP_RULES, treasuryShare: treasuryShareOf(state) };
  if (!state.shop || state.day === undefined) return { shop: null, you: null, rules };
  const keeper = keeperId && isTownsfolk(state, keeperId) ? (author(keeperId) ?? null) : null;
  const mine = viewer && state.residents[viewer] ? shopFor(state, viewer) : null;
  const holiday = holidayOn(state.day);
  return {
    shop: {
      day: state.day,
      season: seasonOf(state.day),
      ...(holiday ? { holiday: { id: holiday.holiday, lastDay: holiday.lastDay } } : {}),
      keeper,
      items: itemsOn(state, state.day),
      ...(state.recipes ? { recipes: cardsOn(state, state.day, mine ? viewer : undefined) } : {}),
      buying: buyingToday(state, mine ? viewer : undefined),
      tiles: shopTiles(state.config),
    },
    you: mine && viewer ? { balance: coinsOf(state, viewer), wardrobe: mine.wardrobe } : null,
    rules,
  };
}
