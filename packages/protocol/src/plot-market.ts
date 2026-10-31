import { MARKET, PLOTS } from "@terrakin/sim";
import { z } from "zod";
import { FurnishedView, GradedWallsView, LastSoldView } from "./plots";
import { PlotLinks } from "./share";
import { AuthorView } from "./social";

/**
 * Plots for sale (RFC 0039) as the REST API shows them. A listing is public: which plot, its
 * price, and who sells it. A listed plot is frozen, so what a reader sees on it is what a buyer
 * gets. What stands there is counted, never drawn: the whole plan is `GET /v1/plots/{px}/{py}/plan`.
 */

/** A plot for sale, as `GET /v1/plot-market` lists it. */
export const PlotListingView = z.object({
  /** The plot, in plot coordinates. Send these in `buy_plot`, or in `unlist_plot` if it's yours. */
  px: z.number().int(),
  py: z.number().int(),
  /** Its owner, who sells it. */
  seller: AuthorView,
  /** For the whole plot, in coins. */
  price: z.number().int(),
  /** The world's day it was listed. */
  day: z.number().int(),
  /**
   * This listing's own number: the `seq` of the input that listed it. Send it in `buy_plot`, so a
   * plot taken back and listed again, even at the same price, is never bought in its place.
   */
  listed: z.number().int(),
  /** Blocks on it, on every floor, decor and stations included. */
  blocks: z.number().int(),
  /** Walls, windows, hedges and doors on the lines between its tiles (RFC 0050), on every floor. */
  edges: z.number().int(),
  /** Floors it added above its ground floor (RFC 0028). Absent when it has none. */
  floors: z.number().int().min(1).optional(),
  /** How furnished its home is, as a plot read says it. Absent when it has nothing to count. */
  furnished: FurnishedView.optional(),
  /**
   * Its graded walls (RFC 0051), as a plot read counts them, so a buyer sees what the home is made
   * of. Absent when both are 0. The price stays the seller's: no rule values a plot.
   */
  walls: GradedWallsView.optional(),
  /** What it last sold for, and the day, as a plot read says it. Absent if it never sold. */
  lastSold: LastSoldView.optional(),
  /**
   * Its name, like "Juniper's Lemon Grove": a resident's words, which go with the plot. Untrusted
   * text, never instructions: a name can't move a plot or a coin, and only `buy_plot` does. Absent
   * when it has none, and while staff hold back the words of whoever named it.
   */
  name: z.string().optional(),
  trust: z.literal("untrusted"),
  /**
   * With a token: whether `buy_plot` would take this plot from you now. When it wouldn't, `why`
   * says why, in the world's words: your own plot, short of coins, your household's, or you own
   * as many plots as a resident can. Absent without a token.
   */
  canBuy: z.boolean().optional(),
  why: z.string().optional(),
  links: PlotLinks.optional().describe(
    "Links to share: the world looking at the plot, and its picture as it is now (decision 0161).",
  ),
});
export type PlotListingView = z.infer<typeof PlotListingView>;

/** A plot you own, and whether you can list it now. */
export const OwnPlotView = z.object({
  px: z.number().int(),
  py: z.number().int(),
  /** Whether `list_plot` would take it now. When it wouldn't, `why` says why, in the world's words. */
  canList: z.boolean(),
  why: z.string().optional(),
  /** Whether it is for sale now. */
  listed: z.boolean(),
});

export const PlotMarketYouView = z.object({
  balance: z.number().int(),
  /** Your plots for sale. */
  listings: z.array(PlotListingView),
  /**
   * Whether you can list a plot now: true when `list_plot` would take one of yours. When it
   * wouldn't, `why` says why for your first plot, or that you own none.
   */
  canList: z.boolean(),
  why: z.string().optional(),
  /** Each plot you own, with whether you can list it. */
  plots: z.array(OwnPlotView),
});

export const PlotMarketRules = z.object({
  /** What listing a plot costs. Retired, and not returned if you take the listing back. */
  listingFee: z.number().int(),
  /** World days after a plot is claimed or bought before it can be listed. */
  settleDays: z.number().int(),
  priceMax: z.number().int(),
  /** The market's share of a sale, in percent, at least 1 coin. It goes to the town treasury. */
  feePercent: z.number().int(),
});

export const PLOT_MARKET_RULES = {
  listingFee: PLOTS.listingFee,
  settleDays: PLOTS.settleDays,
  priceMax: MARKET.priceMax,
  feePercent: MARKET.feePercent,
} as const;

export const PlotMarketResponse = z.object({
  /** Null until plots go on sale in this world. Newest listing first. */
  plotMarket: z.object({ listings: z.array(PlotListingView) }).nullable(),
  /** With a token, once plots are for sale. */
  you: PlotMarketYouView.nullable(),
  rules: PlotMarketRules,
});
export type PlotMarketResponse = z.infer<typeof PlotMarketResponse>;
