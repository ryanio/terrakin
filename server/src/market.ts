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
  listingById,
  listingsOf,
  takenDownOf,
  type WorldState,
} from "@terrakin/sim";

/**
 * The market (RFC 0008, phase 4) as the API shows it, and who may list. The sim holds the listings
 * and their lots; this adds names, filters, and the server's own gate on listing.
 */

/** The most listings one page carries. */
const LISTINGS_SHOWN = 200;

/** The number in a listing's id, `l_<n>`. Higher is newer. */
const listingNumber = (id: string) => Number(id.slice(2));

/** Newest first: the higher number comes first. */
const newer = (a: Listing, b: Listing) => listingNumber(b.id) - listingNumber(a.id);

/** Cheapest first by price per item (compared without dividing), then newest. */
const cheaper = (a: Listing, b: Listing) => a.price * b.count - b.price * a.count || newer(a, b);

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
  /** The `next` cursor from the previous page: the last listing it showed. */
  before?: string | undefined;
}

/**
 * `GET /v1/market`, a page at a time like the feed: `before` is the last listing of the page
 * before, and `next` is null on the last page. `hidden` leaves out sellers the viewer shouldn't see
 * (blocks either way, suspensions), and `lister` gives the gate's facts about the viewer. Returns
 * `{ error }` when a `cheapest` page starts from a listing that has gone, since its price is what
 * placed it.
 */
export function marketView(
  state: WorldState,
  viewer: string | undefined,
  query: MarketQuery,
  author: (id: string) => AuthorView | undefined,
  hidden: (seller: string) => boolean,
  lister: (id: string) => ListerFacts,
): MarketResponse | { error: string } {
  if (!state.market) return { market: null, you: null, rules: MARKET_RULES };
  const cheapest = query.sort === "cheapest";
  const before = query.before;
  let after = (_: Listing) => true;
  if (before !== undefined && cheapest) {
    const cursor = listingById(state, before);
    if (!cursor || cursor.takenDown) {
      return {
        error:
          "That listing has sold or been taken back, so the cheapest order can't carry on from it. Start again without `before`.",
      };
    }
    after = (l) => cheaper(cursor, l) < 0;
  } else if (before !== undefined) {
    // Newest pages need only the id, so they carry on past a listing that sold in between.
    after = (l) => listingNumber(l.id) < listingNumber(before);
  }
  const listings = listingsOf(state)
    .filter(
      (l) =>
        (query.kind === undefined || l.kind === query.kind) &&
        (query.seller === undefined || l.seller === query.seller) &&
        after(l) &&
        !hidden(l.seller),
    )
    .sort(cheapest ? cheaper : newer);
  const page = listings.slice(0, LISTINGS_SHOWN);
  const last = page.at(-1);
  const views = page.flatMap((l) => listingView(l, author) ?? []);
  let you: MarketResponse["you"] = null;
  if (viewer && state.residents[viewer]) {
    const why = listingRefusal(state, viewer, lister(viewer));
    const takenDown = takenDownOf(state, viewer).flatMap((l) => listingView(l, author) ?? []);
    you = {
      balance: coinsOf(state, viewer),
      listings: listingsOf(state).filter((l) => l.seller === viewer).length,
      canList: why === null,
      ...(why === null ? {} : { why }),
      ...(takenDown.length > 0 ? { takenDown } : {}),
    };
  }
  return {
    market: {
      listings: views,
      next: listings.length > LISTINGS_SHOWN && last ? last.id : null,
    },
    you,
    rules: MARKET_RULES,
  };
}

/**
 * An open listing as staff read it in the review queue: its seller, and its lot with each made
 * thing's label on a line of its own. The labels are residents' words. Undefined when it isn't in
 * the market.
 */
export function listingForReport(
  state: WorldState,
  id: string,
): { seller: string; text: string } | undefined {
  const l = listingById(state, id);
  if (!l || l.takenDown) return undefined;
  const labels = (l.goods ?? []).flatMap((g) => (g.label ? [g.label] : []));
  return {
    seller: l.seller,
    text: [`${lotName(l.kind, l.count)} for ${l.price} coins`, ...labels].join("\n"),
  };
}
