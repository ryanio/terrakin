import {
  type AuthorView,
  PLOT_MARKET_RULES,
  type PlotListingView,
  type PlotMarketResponse,
  type PlotSaleView,
} from "@terrakin/protocol";
import {
  coinsOf,
  furnishing,
  type GradedWalls,
  gradedWalls,
  type Input,
  listPlotProblem,
  own,
  PLOTS,
  type PlotListing,
  plotKey,
  plotListing,
  plotListings,
  plotSale,
  plotsOwnedBy,
  type WorldState,
} from "@terrakin/sim";
import { blocksOnPlot, edgeCounts, furnishedView, shownPlotName, wallsView } from "./plots";

/**
 * Plots for sale (RFC 0039) as the API shows them. The sim holds the listings and every rule; this
 * adds names, counts, and the answer a `list_plot` or `buy_plot` carries, read before its commit.
 */

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
    blocks: blocksOnPlot(state, l.px, l.py),
    edges: counts.edges.get(plotKey(l.px, l.py)) ?? 0,
    ...(plot.floors ? { floors: plot.floors } : {}),
    ...furnishedView(furnishing(state, l.px, l.py)),
    ...wallsView(counts.graded.get(plotKey(l.px, l.py))),
    ...(name === undefined ? {} : { name }),
    trust: "untrusted",
  };
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
  const listings = all.flatMap((l) =>
    read.hidden(l.seller) ? [] : (listingView(state, l, read, counts) ?? []),
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
  const mine = sale.hearths.includes(input.actor);
  const note = selling
    ? clearsHearth
      ? mine
        ? "When it sells, your hearth there is cleared: no pantry and no allowance until you settle again. Everything built on it goes to the buyer."
        : "When it sells, the hearth on it is cleared, and everything built on it goes to the buyer."
      : "When it sells, everything built on it goes to the buyer."
    : clearsHearth
      ? "The sale clears the seller's hearth on the plot, and anyone it was shared with loses their share. Everything built on it is yours, as it stands."
      : "Everything built on it is yours, as it stands, and anyone it was shared with loses their share.";
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
      note,
    },
  };
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
