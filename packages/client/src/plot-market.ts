/**
 * Plots for sale (RFC 0039) in the web's words: refusals, a price checked before it's sent, what
 * stands on a plot for sale, the numbers a dry run gives back, and each of your plots' line. Pure,
 * so the tests pin every line. The server decides everything; these only say it.
 */
import type { PlotListingView, PlotMarketResponse, PlotSaleView } from "@terrakin/protocol";
import { relativeDayWords } from "@terrakin/sim";
import { plural } from "@terrakin/ui/format";
import { coins } from "./purse";

type Rules = PlotMarketResponse["rules"];
type OwnPlot = NonNullable<PlotMarketResponse["you"]>["plots"][number];

/** Which plot-market action a refusal answered. */
export type PlotMove = "buy" | "list" | "unlist";

/**
 * A refusal from `buy_plot`, `list_plot`, or `unlist_plot`, said for the page. Where the world's
 * words name an action to send or a route to read, the web says it its own way; where they're
 * already plain (townsfolk, the island, a hall, an event, a household, not yet, short of coins),
 * they're shown as the world said them.
 */
export function plotMarketProblem(
  code: string,
  message: string,
  rules: Pick<Rules, "priceMax">,
  move: PlotMove,
): string {
  switch (code) {
    case "market_closed":
      return "Plots aren't on sale yet.";
    case "not_joined":
      return "Join Terrakin to buy or sell a plot.";
    case "out_of_bounds":
      return "That plot isn't there anymore. Open the market again.";
    case "not_your_plot":
      return "You can only sell a plot you own.";
    case "invalid_amount":
      return priceWords(rules);
    case "plot_listed":
      return "This plot is already for sale. Take it back first to change its price.";
    case "unknown_listing":
      return move === "buy"
        ? "That plot isn't for sale anymore. Someone bought it, or its owner took it back."
        : "That plot isn't for sale anymore.";
    case "own_listing":
      return "That's your own plot. Take it back from Your plots instead.";
    case "plot_limit": {
      const most = /(\d+) plots/.exec(message);
      return most
        ? `You already own ${most[1]} plots, the most a resident can. Sell one first.`
        : "You already own a plot, and a resident owns one here.";
    }
    default:
      return message;
  }
}

const priceWords = (rules: Pick<Rules, "priceMax">) =>
  `A price is a whole number of coins from 1 to ${coins(rules.priceMax)}.`;

/** Why a price typed in the List sheet can't be sent, or null when it can. */
export function priceProblem(typed: string, rules: Pick<Rules, "priceMax">): string | null {
  const n = Number(typed);
  return typed.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= rules.priceMax
    ? null
    : priceWords(rules);
}

/**
 * What stands on a plot for sale and when it went up: "12 blocks and an upstairs. Listed 2 days
 * ago." The second sentence only once the world's day is known.
 */
export function listingFacts(
  l: Pick<PlotListingView, "blocks" | "floors" | "day">,
  today: number | undefined,
): string {
  const floors = l.floors ?? 0;
  const up = floors === 0 ? "" : floors === 1 ? " and an upstairs" : ` and ${floors} floors up`;
  const built =
    l.blocks === 0 && floors === 0
      ? "Nothing built on it yet."
      : `${plural(l.blocks, "block", "blocks")}${up}.`;
  if (today === undefined) return built;
  return `${built} Listed ${relativeDayWords(l.day, today)}.`;
}

/** The numbers a dry run gives back, as label and value rows for a sheet. */
export function saleRows(
  sale: PlotSaleView,
  move: "buy" | "list",
  rules: Pick<Rules, "feePercent">,
): { label: string; value: string }[] {
  if (move === "buy") {
    return [
      { label: "Price", value: coins(sale.price) },
      { label: "Your coins after", value: coins(sale.balanceAfter) },
    ];
  }
  return [
    { label: "Listing costs now", value: coins(sale.listingFee ?? 0) },
    {
      label: `When it sells, after the town's ${rules.feePercent}%`,
      value: coins(sale.sellerGets),
    },
    { label: "Your coins after", value: coins(sale.balanceAfter) },
  ];
}

/**
 * What a plot of yours under "Your plots" is called, and its Sell sheet's title: the home's name
 * when it has one (a resident's words, text only), else "Your home" for the plot with your hearth,
 * else "Your plot at (3, 2)", so no two rows read the same.
 */
export function ownPlotTitle(
  at: { px: number; py: number },
  name: string | undefined,
  hearthHere: boolean,
): { title: string; sell: string } {
  if (name) return { title: name, sell: `Sell ${name}` };
  if (hearthHere) return { title: "Your home", sell: "Sell your home" };
  const where = `at (${at.px}, ${at.py})`;
  return { title: `Your plot ${where}`, sell: `Sell your plot ${where}` };
}

/**
 * A plot of yours under "Your plots": for sale at its price, ready to sell (no line, the Sell
 * button says it), or why not, in the world's words made plain.
 */
export function ownPlotLine(
  plot: OwnPlot,
  listing: Pick<PlotListingView, "price"> | undefined,
  rules: Pick<Rules, "priceMax">,
): string | null {
  if (plot.listed && listing) return `For sale at ${coins(listing.price)}`;
  if (plot.canList) return null;
  return plotMarketProblem("", plot.why ?? "You can't sell it yet.", rules, "list");
}
