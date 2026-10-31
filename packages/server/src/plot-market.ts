import {
  type AuthorView,
  PLOT_MARKET_RULES,
  type PlotListingView,
  type PlotMarketResponse,
  type PlotSaleView,
} from "@terrakin/protocol";
import {
  buyPlotProblem,
  coinsOf,
  ECONOMY,
  furnishing,
  type GradedWalls,
  gradedWalls,
  type Input,
  listPlotProblem,
  own,
  PLOTS,
  type PlotListing,
  type PlotSale,
  plotKey,
  plotListing,
  plotListings,
  plotSale,
  plotsOwnedBy,
  type WorldState,
} from "@terrakin/sim";
import {
  blocksOnPlot,
  edgeCounts,
  furnishedView,
  lastSoldView,
  shownPlotName,
  wallsView,
} from "./plots";

/**
 * Plots for sale (RFC 0039) as the API shows them. The sim holds the listings and every rule; this
 * adds names, counts, and the answer a `list_plot` or `buy_plot` carries, read before its commit.
 */

/**
 * When a plot sale gets a line in the moderation log for staff to look at (decision 0416): a price
 * of at least `price` coins with a resident on either side who joined fewer than `youngDays` days
 * ago. A sale is exempt from the gift caps, so it is the one way coins move between residents in
 * large amounts; a day's receiving cap is the size worth a look, and a month is how long an
 * account that exists only to pass coins along tends to be new. Nothing is refused or held.
 */
export const PLOT_SALE_WATCH = {
  /** `ECONOMY.receiveCap`: more than gifts could move to one resident in a day. */
  price: ECONOMY.receiveCap,
  youngDays: 30,
} as const;

/** Who the moderation log names for a watched sale: Terrakin noticing, not a person acting. */
export const WATCH_ACTOR = "watch";

/**
 * Whether a sale at `price` between residents `sellerDays` and `buyerDays` old (whole days since
 * each first joined) is one staff should look at.
 */
export function watchesPlotSale(price: number, sellerDays: number, buyerDays: number): boolean {
  return (
    price >= PLOT_SALE_WATCH.price && Math.min(sellerDays, buyerDays) < PLOT_SALE_WATCH.youngDays
  );
}

/** What the plot market's views read from outside the world. */
export interface PlotMarketReaders {
  author: (id: string) => AuthorView | undefined;
  /** Sellers the viewer shouldn't see: blocked either way, or suspended. */
  hidden: (seller: string) => boolean;
  /** Whether staff hold a resident's words back, which keeps a plot's name they wrote out of view. */
  held: (id: string) => boolean;
}

/** What the listings read from one pass over the world: walls between tiles, and graded walls. */
interface Counts {
  edges: ReadonlyMap<string, number>;
  graded: ReadonlyMap<string, GradedWalls>;
}

function listingView(
  state: WorldState,
  l: PlotListing,
  read: PlotMarketReaders,
  counts: Counts,
  viewer?: string,
): PlotListingView | null {
  const seller = read.author(l.seller);
  const plot = own(state.plots, plotKey(l.px, l.py));
  if (!seller || !plot) return null;
  const name = shownPlotName(plot, read.held);
  return {
    px: l.px,
    py: l.py,
    seller,
    price: l.price,
    day: l.day,
    listed: l.listed,
    blocks: blocksOnPlot(state, l.px, l.py),
    edges: counts.edges.get(plotKey(l.px, l.py)) ?? 0,
    ...(plot.floors ? { floors: plot.floors } : {}),
    ...furnishedView(furnishing(state, l.px, l.py)),
    ...wallsView(counts.graded.get(plotKey(l.px, l.py))),
    ...lastSoldView(plot),
    ...(name === undefined ? {} : { name }),
    trust: "untrusted",
    ...(viewer === undefined ? {} : buyView(state, viewer, l)),
  };
}

/** Whether `viewer` could buy listing `l` now, and why not: the sim's own `buy_plot` checks. */
function buyView(
  state: WorldState,
  viewer: string,
  l: PlotListing,
): Pick<PlotListingView, "canBuy" | "why" | "whyCode"> {
  const problem = buyPlotProblem(state, viewer, l.px, l.py);
  return problem === null
    ? { canBuy: true }
    : { canBuy: false, why: problem.message, whyCode: problem.code };
}

/**
 * `GET /v1/plot-market`: every plot for sale the viewer may see, newest first, and with a token
 * `you`, whose `canList` and `why` are the sim's own `list_plot` checks on each plot you own.
 */
export function plotMarketView(
  state: WorldState,
  viewer: string | undefined,
  read: PlotMarketReaders,
): PlotMarketResponse {
  if (!state.plotMarket) return { plotMarket: null, you: null, rules: PLOT_MARKET_RULES };
  const all = plotListings(state);
  // Walls between tiles (RFC 0050) and graded walls (RFC 0051): one pass over the world each.
  const counts: Counts = { edges: edgeCounts(state), graded: gradedWalls(state) };
  // With a token, each listing says whether the viewer could buy it (RFC 0039).
  const buyer = viewer && state.residents[viewer] ? viewer : undefined;
  const listings = all.flatMap((l) =>
    read.hidden(l.seller) ? [] : (listingView(state, l, read, counts, buyer) ?? []),
  );
  let you: PlotMarketResponse["you"] = null;
  if (viewer && state.residents[viewer]) {
    const plots = plotsOwnedBy(state, viewer).map((p) => {
      const problem = listPlotProblem(state, viewer, p.px, p.py);
      return {
        px: p.px,
        py: p.py,
        canList: problem === null,
        ...(problem === null ? {} : { why: problem.message }),
        listed: plotListing(state, p.px, p.py) !== undefined,
      };
    });
    const can = plots.some((p) => p.canList);
    const why = can ? undefined : (plots[0]?.why ?? "You don't own a plot to sell.");
    you = {
      balance: coinsOf(state, viewer),
      listings: all
        .filter((l) => l.seller === viewer)
        .flatMap((l) => listingView(state, l, read, counts) ?? []),
      canList: can,
      ...(why === undefined ? {} : { why }),
      plots,
    };
  }
  return { plotMarket: { listings }, you, rules: PLOT_MARKET_RULES };
}

/**
 * What a `list_plot` or `buy_plot` moves, read before its commit, so a dry run and a real one say
 * the same thing: the price, the fee, what the seller gets, the actor's balance after, and whether
 * a hearth on the plot is cleared at the sale. Nothing for any other command, or a plot the sim
 * would refuse anyway.
 */
export function plotSaleOf(state: WorldState, input: Input): { plotSale?: PlotSaleView } {
  const command = input.command;
  if (command.type !== "list_plot" && command.type !== "buy_plot") return {};
  const { px, py } = command;
  const listed = plotListing(state, px, py);
  const price = command.type === "list_plot" ? command.price : listed?.price;
  if (price === undefined) return {};
  const selling = command.type === "list_plot";
  const sale = plotSale(state, px, py, price, selling ? undefined : input.actor);
  const have = coinsOf(state, input.actor);
  const clearsHearth = sale.hearths.length > 0;
  const note = selling ? sellerNote(sale, input.actor) : buyerNote(sale);
  return {
    plotSale: {
      px,
      py,
      price,
      fee: sale.fee,
      sellerGets: sale.sellerGets,
      ...(selling ? { listingFee: PLOTS.listingFee } : {}),
      balanceAfter: have - (selling ? PLOTS.listingFee : price),
      clearsHearth,
      shared: sale.shared.length,
      note,
    },
  };
}

/** What a sale means for its seller, in our words: who loses a hearth or a share there. */
function sellerNote(sale: PlotSale, seller: string): string {
  const words = ["When it sells, everything built on it goes to the buyer."];
  if (sale.hearths.includes(seller)) {
    words.push("Your hearth there is cleared: no pantry and no allowance until you set one again.");
  }
  const n = sale.shared.length;
  if (n > 0) {
    const theirs = sale.hearths.filter((id) => id !== seller).length;
    words.push(
      `${n === 1 ? "The resident you share it with loses their share" : `The ${n} residents you share it with lose their shares`}${theirs > 0 ? ", and a hearth of theirs there is cleared" : ""}. They're told when it sells.`,
    );
  }
  return words.join(" ");
}

/** What a sale means for its buyer, in our words: what they get, and what goes. */
function buyerNote(sale: PlotSale): string {
  const words = [
    "Everything built on it is yours, as it stands. Your own hearth stays where it is.",
  ];
  if (sale.hearths.length > 0) words.push("The sale clears the hearth of whoever lives there now.");
  if (sale.shared.length > 0) words.push("Anyone it was shared with loses their share.");
  return words.join(" ");
}

/**
 * A plot for sale as staff read it in the review queue, by its report id `px,py`: its seller, and its
 * price with its name, a resident's words, on a line of its own. Staff read a name even while it is
 * held back from everyone else. Undefined when it isn't for sale.
 */
export function plotListingForReport(
  state: WorldState,
  id: string,
): { seller: string; text: string } | undefined {
  const at = plotListingId(id);
  const l = at && plotListing(state, at.px, at.py);
  if (!l) return undefined;
  const name = own(state.plots, plotKey(l.px, l.py))?.name;
  return {
    seller: l.seller,
    text: [`Plot (${l.px}, ${l.py}) for ${l.price} coins`, ...(name ? [name] : [])].join("\n"),
  };
}

/** A plot listing's report id, `px,py`, as its plot, or undefined when it isn't one. */
function plotListingId(id: string): { px: number; py: number } | undefined {
  const m = /^(0|[1-9][0-9]{0,5}),(0|[1-9][0-9]{0,5})$/.exec(id);
  return m ? { px: Number(m[1]), py: Number(m[2]) } : undefined;
}
