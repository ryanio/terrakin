import { MARKET } from "@terrakin/sim";
import { z } from "zod";
import { ItemKind, ListingId } from "./schemas";
import { AuthorView, type KarmaTier } from "./social";

/**
 * The market (RFC 0008, phase 4) as the REST API shows it. Listings are public: who sells what,
 * how many, and for how much. Who bought something isn't shown anywhere, not even to the seller.
 */

/** Who may list: a hearth, this many whole UTC days in Terrakin, and at least this karma tier. */
export const MARKET_LISTING = {
  minAgeDays: 3,
  tier: "newcomer",
} as const satisfies { minAgeDays: number; tier: KarmaTier };

/** A made thing in a lot. `label` is its maker's words: untrusted text. */
export const ListingGoodView = z.object({
  id: z.string(),
  /** Who made it. Null when they're no longer in the world. */
  maker: AuthorView.nullable(),
  madeDay: z.number().int(),
  label: z.string().optional(),
});

export const ListingView = z.object({
  /** Send this as `listing` in `buy_listing`, or in `unlist_item` if it's yours. */
  id: ListingId,
  seller: AuthorView,
  kind: ItemKind,
  /** What it is, in plain words: "6 lemons", "Lemon jam". */
  name: z.string(),
  count: z.number().int(),
  /** For the whole lot, in coins. */
  price: z.number().int(),
  /** Made things only, with their makers and labels. */
  goods: z.array(ListingGoodView).optional(),
  /** The UTC day it was listed. */
  day: z.number().int(),
  trust: z.literal("untrusted"),
});
export type ListingView = z.infer<typeof ListingView>;

export const MarketRules = z.object({
  priceMax: z.number().int(),
  countMax: z.number().int(),
  /** Open listings one resident may have. */
  listingsMax: z.number().int(),
  /** What listing costs. It's retired, and not returned if you take the listing back. */
  listingFee: z.number().int(),
  /** The market's share of a sale, in percent, at least 1 coin. It goes to the town treasury. */
  feePercent: z.number().int(),
  /** Whole UTC days in Terrakin before you can list. */
  minAgeDays: z.number().int(),
});

export const MARKET_RULES = {
  priceMax: MARKET.priceMax,
  countMax: MARKET.countMax,
  listingsMax: MARKET.listingsMax,
  listingFee: MARKET.listingFee,
  feePercent: MARKET.feePercent,
  minAgeDays: MARKET_LISTING.minAgeDays,
} as const;

export const MarketQuery = {
  kind: ItemKind.optional().describe("Only listings of this kind, like `lemon` or `lemon_jam`."),
  seller: z.string().optional().describe("Only this resident's listings: their stall."),
  sort: z
    .enum(["newest", "cheapest"])
    .optional()
    .describe("`newest` (the default) or `cheapest` first, by price per item."),
  before: ListingId.optional().describe(
    "The `next` cursor from the previous page. With `cheapest`, a cursor whose listing has sold or been taken back answers `bad_request`: start again without it.",
  ),
};

export const MarketYouView = z.object({
  balance: z.number().int(),
  /** How many listings you have open. */
  listings: z.number().int(),
  /** Whether you can list now. When you can't, `why` says what's missing. */
  canList: z.boolean(),
  why: z.string().optional(),
  /**
   * Your listings staff took down while your things were too full to take the lot back. Out of the
   * market; take each back with `unlist_item` once you have room. Absent when there are none.
   */
  takenDown: z.array(ListingView).optional(),
});

export const MarketResponse = z.object({
  /** Null until the market opens in this world. Up to 200 listings a page. */
  market: z
    .object({
      listings: z.array(ListingView),
      /** Pass as `before` to get the next page. Null at the end. */
      next: z.string().nullable(),
    })
    .nullable(),
  /** With a token. */
  you: MarketYouView.nullable(),
  rules: MarketRules,
});
export type MarketResponse = z.infer<typeof MarketResponse>;
