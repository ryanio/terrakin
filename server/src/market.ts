import {
  type AuthorView,
  type KarmaTier,
  type ListingView,
  MARKET_LISTING,
  MARKET_RULES,
  type MarketResponse,
  tierAtLeast,
} from "@terrakin/protocol";
import {
  coinsOf,
  ITEM_INFO,
  type ItemKind,
  isTownsfolk,
  type Listing,
  listingsOf,
  type WorldState,
} from "@terrakin/sim";

/**
 * The market (RFC 0008, phase 4) as the API shows it, and who may list. The sim holds the listings
 * and their lots; this adds names, filters, and the server's own gate on listing.
 */

/** The most listings one answer carries. */
const LISTINGS_SHOWN = 200;

/** "6 lemons", or the thing's name for one. */
export function lotName(kind: ItemKind, count: number): string {
  const info = ITEM_INFO[kind];
  return count === 1 ? info.name : `${count} ${info.plural.toLowerCase()}`;
}

/** What the gate on listing needs to know about a resident, from outside the sim. */
export interface ListerFacts {
  ageDays: number;
  tier: KarmaTier;
}

/**
 * Why a resident can't list yet, or null when they can. The sim checks the hearth too; this is
 * the part it can't see: time in Terrakin and karma (decision 0056).
 */
export function listingRefusal(state: WorldState, id: string, facts: ListerFacts): string | null {
  if (isTownsfolk(state, id)) return "Townsfolk don't trade. Their coins are the town's.";
  if (facts.ageDays < MARKET_LISTING.minAgeDays) {
    return `You can list in the market from your ${ordinal(MARKET_LISTING.minAgeDays + 1)} day in Terrakin.`;
  }
  if (!tierAtLeast(facts.tier, MARKET_LISTING.tier)) {
    return `Listing in the market needs ${MARKET_LISTING.tier} karma or above.`;
  }
  if (!state.residents[id]?.hearth) return "Your stall stands at your hearth. Set one first.";
  return null;
}

const ordinal = (n: number) =>
  n === 2 ? "second" : n === 3 ? "third" : n === 4 ? "fourth" : `${n}th`;

function listingView(
  l: Listing,
  author: (id: string) => AuthorView | undefined,
): ListingView | null {
  const seller = author(l.seller);
  if (!seller) return null;
  return {
    id: l.id,
    seller,
    kind: l.kind,
    name: lotName(l.kind, l.count),
    count: l.count,
    price: l.price,
    ...(l.goods
      ? {
          goods: l.goods.map((g) => ({
            id: g.id,
            maker: author(g.maker) ?? null,
            madeDay: g.madeDay,
            ...(g.label ? { label: g.label } : {}),
          })),
        }
      : {}),
    day: l.day,
    trust: "untrusted",
  };
}

export interface MarketQuery {
  kind?: ItemKind | undefined;
  seller?: string | undefined;
  sort?: "newest" | "cheapest" | undefined;
}

/**
 * `GET /v1/market`. `hidden` leaves out sellers the viewer shouldn't see (blocks either way,
 * suspensions), and `lister` gives the gate's facts about the viewer.
 */
export function marketView(
  state: WorldState,
  viewer: string | undefined,
  query: MarketQuery,
  author: (id: string) => AuthorView | undefined,
  hidden: (seller: string) => boolean,
  lister: (id: string) => ListerFacts,
): MarketResponse {
  if (!state.market) return { market: null, you: null, rules: MARKET_RULES };
  let listings = listingsOf(state).filter(
    (l) =>
      (query.kind === undefined || l.kind === query.kind) &&
      (query.seller === undefined || l.seller === query.seller) &&
      !hidden(l.seller),
  );
  // Newest first by default; cheapest by price per item, then newest.
  listings.reverse();
  if (query.sort === "cheapest") {
    listings = [...listings].sort((a, b) => a.price / a.count - b.price / b.count);
  }
  const views = listings.slice(0, LISTINGS_SHOWN).flatMap((l) => listingView(l, author) ?? []);
  let you: MarketResponse["you"] = null;
  if (viewer && state.residents[viewer]) {
    const why = listingRefusal(state, viewer, lister(viewer));
    you = {
      balance: coinsOf(state, viewer),
      listings: listingsOf(state).filter((l) => l.seller === viewer).length,
      canList: why === null,
      ...(why === null ? {} : { why }),
    };
  }
  return { market: { listings: views }, you, rules: MARKET_RULES };
}
