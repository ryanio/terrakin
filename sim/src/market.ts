import { coinCount as coins, isWhole, refuse } from "./check";
import { ECONOMY, isTownsfolk, movePurse, moveTreasury, pairSkipsCaps } from "./economy";
import {
  addStack,
  countOf,
  held,
  ITEM_ID_PATTERN,
  ITEMS,
  type ItemKind,
  inventory,
  inventoryEvent,
  inventorySize,
  isGoodKind,
  isStackKind,
} from "./items";
import type {
  Command,
  EconomyState,
  Good,
  ItemsState,
  Listing,
  MarketState,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";

/**
 * The market (RFC 0008, phase 4): residents selling things to each other, `list_item`,
 * `unlist_item`, and `buy_listing`.
 *
 * Nothing here runs until the server sends `open_market`, which needs the shop open (and so coins
 * and items), so worlds from before it replay to the hash they always had. A listed lot leaves its
 * seller's things and is held in the listing until it sells or is taken back, so it can't be given
 * or sold twice. Listing costs a coin, which is burned; a sale pays the seller the price less the
 * market fee, which goes to the treasury.
 */

/**
 * The numbers (decision 0056). Replay checks logged trades against them, so changing one needs a
 * logged input that switches it, the way `set_shop_share` does for the shop.
 */
export const MARKET = {
  /** The most a lot may cost. */
  priceMax: 100_000,
  /** The most of one kind in a lot. */
  countMax: 20,
  /** Open listings one resident may have. */
  listingsMax: 20,
  /** What listing costs. Burned, and kept if the listing is taken back. */
  listingFee: 1,
  /** The treasury's share of each sale, in percent, rounded down but at least 1 coin. */
  feePercent: 5,
} as const;

/** The market's fee on a sale at `price`. */
export const marketFee = (price: number) =>
  Math.max(1, Math.floor((price * MARKET.feePercent) / 100));

type Mutation = () => WorldEvent[];
export type MarketChecked = Mutation | Rejection;

interface Open {
  market: MarketState;
  econ: EconomyState;
  items: ItemsState;
  day: number;
}

/**
 * The checks every market command shares: the market open, and a resident who isn't townsfolk
 * (`townsfolk: true` lets them through, so someone who joined the townsfolk can still take their
 * listings back).
 */
function opened(
  state: WorldState,
  actor: ResidentId,
  { townsfolk = false } = {},
): Open | Rejection {
  const { market, economy: econ, items, day } = state;
  if (!market || !econ || !items || day === undefined) {
    return refuse("market_closed", "The market hasn't opened in this world yet.");
  }
  if (!state.residents[actor]) return refuse("not_joined", "Join the world first.");
  if (!townsfolk && isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk don't trade. Their coins are the town's.");
  }
  return { market, econ, items, day };
}

/** Open listings, oldest first. Lots staff took down and are holding for their sellers aren't. */
export function listingsOf(state: WorldState): Listing[] {
  return Object.values(state.market?.listings ?? {})
    .filter((l) => !l.takenDown)
    .sort((a, b) => listingNumber(a) - listingNumber(b));
}

const listingNumber = (l: Listing) => Number(l.id.slice(2));

/**
 * The listing with this id, open or taken down. An own-property lookup, so an id like `__proto__`
 * finds nothing instead of `Object.prototype`.
 */
export function listingById(state: WorldState, id: string): Listing | undefined {
  const listings = state.market?.listings;
  return listings && typeof id === "string" && Object.hasOwn(listings, id)
    ? listings[id]
    : undefined;
}

/** One resident's open listings, oldest first. */
export const stallOf = (state: WorldState, id: ResidentId) =>
  listingsOf(state).filter((l) => l.seller === id);

/**
 * A resident's lots that staff took down while their things were full, oldest first. Theirs to
 * take back with `unlist_item` once they have room; nobody else sees them.
 */
export const takenDownOf = (state: WorldState, id: ResidentId) =>
  Object.values(state.market?.listings ?? {})
    .filter((l) => l.takenDown && l.seller === id)
    .sort((a, b) => listingNumber(a) - listingNumber(b));

const copyListing = (l: Listing): Listing => ({
  ...l,
  ...(l.goods ? { goods: l.goods.map((g) => ({ ...g })) } : {}),
});

// ---------- server input ----------

/** `open_market`, which only TOWN_ACTOR sends. Needs the town shop open. */
export function checkOpenMarket(state: WorldState): MarketChecked {
  if (state.market) return refuse("already_open", "The market is already open.");
  if (!state.shop) return refuse("not_due", "The market opens once the town shop has.");
  return () => {
    state.market = { nextId: 1, listings: {} };
    return [{ type: "market_opened" }];
  };
}

// ---------- listing ----------

/**
 * `list_item {item, count?, price}`. `item` is a made thing's id (`i_12`) or a kind: a stack
 * (`lemon`, `count` of them) or a made kind (`lemon_jam`, your oldest `count` of them). The price
 * is for the whole lot. Needs a hearth: a stall stands at home.
 */
export function checkListItem(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "list_item" }>,
): MarketChecked {
  const open = opened(state, actor);
  if ("code" in open) return open;
  const { market, econ, items, day } = open;
  const { item, price } = command;
  const count = command.count ?? 1;
  if (!isWhole(count) || count < 1 || count > MARKET.countMax) {
    return refuse("invalid_amount", `List 1 to ${MARKET.countMax} at a time.`);
  }
  if (!isWhole(price) || price < 1 || price > MARKET.priceMax) {
    return refuse("invalid_amount", "A price is a whole number of coins, 1 to 100,000.");
  }
  if (!state.residents[actor]?.hearth) {
    return refuse("no_hearth", "Your stall stands at your hearth. Set one on your plot first.");
  }
  const inv = items.inventories[actor];
  let kind: ItemKind;
  let goods: Good[] = [];
  if (typeof item === "string" && ITEM_ID_PATTERN.test(item)) {
    const good = inv?.goods.find((g) => g.id === item);
    if (!good) return refuse("not_enough_items", "You don't have that.");
    if (count !== 1) return refuse("invalid_amount", "An item id is one thing. Leave out count.");
    kind = good.kind;
    goods = [good];
  } else if (isGoodKind(item)) {
    kind = item;
    goods = (inv?.goods ?? []).filter((g) => g.kind === item).slice(0, count);
    if (goods.length < count) {
      return refuse("not_enough_items", `You have ${countOf(item, goods.length)}.`);
    }
  } else if (isStackKind(item)) {
    kind = item;
    if (held(inv, item) < count) {
      return refuse("not_enough_items", `You have ${countOf(item, held(inv, item))}.`);
    }
  } else {
    return refuse("unknown_item", "That isn't something you can hold. Check GET /v1/inventory.");
  }
  const selling = Object.values(market.listings).filter(
    (l) => l.seller === actor && !l.takenDown,
  ).length;
  if (selling >= MARKET.listingsMax) {
    return refuse(
      "listing_limit",
      `You have ${MARKET.listingsMax} things up for sale. Take one back or wait for a sale first.`,
    );
  }
  const have = econ.coins[actor] ?? 0;
  if (have < MARKET.listingFee) {
    return refuse(
      "not_enough_coins",
      `Listing costs ${coins(MARKET.listingFee)}, and you have ${coins(have)}.`,
    );
  }
  const at = { seq: state.seq + 1, day };
  const ids = goods.map((g) => g.id);
  return () => {
    const id = `l_${market.nextId}`;
    market.nextId += 1;
    const listing: Listing = {
      id,
      seller: actor,
      kind,
      count,
      ...(goods.length > 0 ? { goods: goods.map((g) => ({ ...g })) } : {}),
      price,
      day,
    };
    market.listings[id] = listing;
    const mine = inventory(items, actor);
    let moved: WorldEvent;
    if (isStackKind(kind)) {
      moved = inventoryEvent(actor, "listed", [addStack(mine, kind, -count)]);
    } else {
      mine.goods = mine.goods.filter((g) => !ids.includes(g.id));
      moved = inventoryEvent(actor, "listed", [], { lost: ids });
    }
    econ.burned += MARKET.listingFee;
    return [
      movePurse(econ, actor, -MARKET.listingFee, "listing_fee", at),
      moved,
      { type: "listed", listing: copyListing(listing) },
    ];
  };
}

/** Whether a lot fits in a resident's things now. */
const fits = (items: ItemsState, id: ResidentId, listing: Listing) =>
  inventorySize(items.inventories[id]) + listing.count <= ITEMS.inventoryMax;

/** Put a lot into a resident's things, with their private inventory event. */
function receive(
  items: ItemsState,
  id: ResidentId,
  listing: Listing,
  reason: "unlisted" | "market" | "taken_down",
) {
  const theirs = inventory(items, id);
  if (isStackKind(listing.kind)) {
    return inventoryEvent(id, reason, [addStack(theirs, listing.kind, listing.count)]);
  }
  const goods = listing.goods ?? [];
  theirs.goods.push(...goods.map((g) => ({ ...g })));
  return inventoryEvent(id, reason, [], { gained: goods });
}

/**
 * `unlist_item {listing}`: take your own listing back. The listing fee isn't returned. It also
 * collects a lot staff took down while your things were full.
 */
export function checkUnlistItem(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "unlist_item" }>,
): MarketChecked {
  const open = opened(state, actor, { townsfolk: true });
  if ("code" in open) return open;
  const { market, items } = open;
  const listing = listingById(state, command.listing);
  if (!listing) return refuse("unknown_listing", "That listing isn't open. See GET /v1/market.");
  if (listing.seller !== actor) return refuse("not_eligible", "That's someone else's listing.");
  if (!fits(items, actor, listing)) {
    return refuse("inventory_full", `You can hold ${ITEMS.inventoryMax} things. Make room first.`);
  }
  return () => {
    delete market.listings[listing.id];
    return [
      receive(items, actor, listing, "unlisted"),
      { type: "unlisted", listing: listing.id, seller: actor },
    ];
  };
}

/**
 * `buy_listing {listing}`: pay the price and take the lot. The seller gets the price less the
 * market fee (`marketFee`), which goes to the treasury in a line that names nobody.
 */
export function checkBuyListing(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "buy_listing" }>,
): MarketChecked {
  const open = opened(state, actor);
  if ("code" in open) return open;
  const { market, econ, items, day } = open;
  const listing = listingById(state, command.listing);
  if (!listing || listing.takenDown) {
    return refuse("unknown_listing", "That listing isn't open. See GET /v1/market.");
  }
  if (listing.seller === actor) {
    return refuse("own_listing", "That's your own listing. Take it back with unlist_item.");
  }
  // A sale moves coins and things between two residents, so it keeps to the gift caps: no buying
  // on your first day, the seller's proceeds count toward the coins they receive today, and the
  // lot toward the things you receive today. A person and their AI skip them, as with gifts.
  if (econ.today.newcomers.includes(actor)) {
    return refuse("gift_limit", "You can buy in the market from your second day.");
  }
  const { seller } = listing;
  const paired = pairSkipsCaps(state, actor, seller);
  const sold = econ.today.received[seller] ?? 0;
  if (!paired && sold >= ECONOMY.receiveCap) {
    return refuse(
      "gift_limit",
      `A resident can take in ${coins(ECONOMY.receiveCap)} from gifts and sales a day, and this seller has today. Try tomorrow.`,
    );
  }
  const got = items.today.received[actor] ?? 0;
  if (!paired && got >= ITEMS.receiveCap) {
    return refuse(
      "gift_limit",
      `You can take in ${ITEMS.receiveCap} things from gifts and the market a day, and you have today. Try tomorrow.`,
    );
  }
  const have = econ.coins[actor] ?? 0;
  if (have < listing.price) {
    return refuse(
      "not_enough_coins",
      `That's ${coins(listing.price)}, and you have ${coins(have)}.`,
    );
  }
  if (!fits(items, actor, listing)) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things. Make, place, give, or sell something first.`,
    );
  }
  const fee = marketFee(listing.price);
  const at = { seq: state.seq + 1, day };
  const { price } = listing;
  return () => {
    delete market.listings[listing.id];
    if (!paired) {
      econ.today.received[seller] = sold + price - fee;
      items.today.received[actor] = got + listing.count;
    }
    const events: WorldEvent[] = [
      movePurse(econ, actor, -price, "market_buy", at, { with: seller }),
    ];
    // The seller's line doesn't say who bought: that's the buyer's to tell.
    if (price > fee) events.push(movePurse(econ, seller, price - fee, "market_sale", at));
    events.push(moveTreasury(econ, Math.min(fee, price), "market_fee", at));
    events.push(receive(items, actor, listing, "market"));
    events.push({
      type: "listing_sold",
      listing: listing.id,
      seller,
      kind: listing.kind,
      count: listing.count,
      price,
    });
    return events;
  };
}

// ---------- staff ----------

/**
 * `remove_listing {listing}`, which only TOWN_ACTOR sends: staff took a listing down (decision
 * 0056). The lot goes back to its seller with their makers and labels. When their things are too
 * full for it, it stays in the market out of view (`takenDown`) until they take it back with
 * `unlist_item`, so nothing is lost and nothing goes past `inventoryMax`. The listing fee stays
 * burned, and no other coins move.
 */
export function checkRemoveListing(
  state: WorldState,
  command: Extract<Command, { type: "remove_listing" }>,
): MarketChecked {
  const { market, items } = state;
  if (!market || !items) {
    return refuse("market_closed", "The market hasn't opened in this world yet.");
  }
  const listing = listingById(state, command.listing);
  if (!listing || listing.takenDown) {
    return refuse("unknown_listing", "That listing isn't open.");
  }
  const { seller } = listing;
  const room = fits(items, seller, listing);
  return () => {
    const removed: WorldEvent = { type: "listing_removed", listing: listing.id, seller };
    if (!room) {
      listing.takenDown = true;
      return [removed];
    }
    delete market.listings[listing.id];
    return [receive(items, seller, listing, "taken_down"), removed];
  };
}
