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
  clayOpen,
  coinsOf,
  holidaysOn,
  ITEM_INFO,
  isTownsfolk,
  type KindRecipe,
  knows,
  nearestCounter,
  notAtTheCounter,
  onSale,
  onShelf,
  priceOf,
  type Resident,
  recipeCardPrice,
  residentById,
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
  const holidays = holidaysOn(day);
  return SHOP_ITEMS.filter((item) => onSale(item.sku, day)).map((item) => {
    const holiday = holidays.find((h) => h.holiday === item.holiday);
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
    if (!onShelf(recipe, day, clayOpen(state))) return [];
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
  return { tiles: shopTiles(state), buying: buyingToday(state) };
}

/**
 * `counter` and `away` on `GET /v1/shop`'s `you`, in a world that needs you at the shop: the
 * door, and why buying and selling would refuse you from where you stand. Empty where the shop
 * serves from anywhere, so such a world's answer is what it always was.
 */
function counterFields(
  state: WorldState,
  me: Resident,
): { counter?: { x: number; y: number }; away?: string } {
  if (!state.shop?.inPerson) return {};
  const away = notAtTheCounter(state, me);
  // The counter the caller would be served at, which once a land is open is the one on the land
  // they stand on (RFC 0038), so a reader still gets one tile and it is the right one.
  return { counter: nearestCounter(state, me), ...(away ? { away: away.message } : {}) };
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
  const me = viewer ? residentById(state, viewer) : undefined;
  const mine = viewer && me ? shopFor(state, viewer) : null;
  const holidays = holidaysOn(state.day).map((h) => ({ id: h.holiday, lastDay: h.lastDay }));
  return {
    shop: {
      day: state.day,
      season: seasonOf(state.day),
      ...(holidays.length > 0 ? { holidays } : {}),
      keeper,
      items: itemsOn(state, state.day),
      ...(state.recipes ? { recipes: cardsOn(state, state.day, mine ? viewer : undefined) } : {}),
      buying: buyingToday(state, mine ? viewer : undefined),
      tiles: shopTiles(state),
    },
    you:
      mine && me
        ? {
            balance: coinsOf(state, viewer as string),
            wardrobe: mine.wardrobe,
            // Once the world needs you at the counter (RFC 0042), say where it is and, from where
            // you stand, why buying would refuse you, in the sim's own words with its walk. The
            // client shows this rather than deciding anything.
            ...counterFields(state, me),
          }
        : null,
    rules,
  };
}
