/**
 * Plots for sale (RFC 0039) at the top of `/market`, where `/market#plots` lands: each plot on sale
 * as a row with its picture, its name, its price and seller, what stands on it, and a way to go and
 * see it, then your own plots with what each can do. Drawn only once the world sells plots: while
 * `GET /v1/plot-market` answers `plotMarket: null` the market page has no section at all
 * (decision 0365). A plot's name and its seller's are residents' words: text nodes only.
 */
import type { PlotListingView, PlotMarketResponse, WorldSnapshot } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { personLink } from "@terrakin/ui/people";
import { confirmTwice, emptyNote, itemRow, itemRows } from "@terrakin/ui/ui";
import { listingAction } from "./market-words";
import { listingFacts, ownPlotLine } from "./plot-market";
import { plotThumb } from "./plot-thumb";
import { coins } from "./purse";
import { reportMenu } from "./report-sheet";
import { plotTitles } from "./visits";
import { worldLinkPath } from "./world-link";
import "./plot-market-section.css";

type Data = PlotMarketResponse & { plotMarket: NonNullable<PlotMarketResponse["plotMarket"]> };
type OwnPlot = NonNullable<PlotMarketResponse["you"]>["plots"][number];

/** What the section's buttons do. The page sends the action and reads the market again. */
export interface PlotMarketMoves {
  /** Take a plot of yours off the market. */
  unlist: (button: HTMLButtonElement, at: { px: number; py: number }) => void;
  /** Open the Buy sheet for a plot for sale. */
  buy: (listing: PlotListingView, title: string) => void;
  /** Open the Sell sheet for a plot of yours, by its name when it has one. */
  sell: (at: { px: number; py: number }, name: string | null) => void;
}

/** A pill in a row's trail, named with the plot it's for. */
const rowButton = (text: string, title: string) =>
  h("button", {
    class: "pill-button small market-act",
    attrs: { type: "button", "aria-label": `${text}: ${title}` },
    text,
  });

const thumb = (world: WorldSnapshot | null, at: { px: number; py: number }, label: string) =>
  world ? plotThumb(world, at, label, 48) : null;

const seeIt = (at: { px: number; py: number }) =>
  h("a", {
    class: "plot-sale-see",
    attrs: { href: worldLinkPath({ kind: "plot", px: at.px, py: at.py }) },
    text: "Go see it",
  });

/** Take back, behind a second tap, since the listing fee doesn't come back. */
function takeBack(
  at: { px: number; py: number },
  title: string,
  rules: PlotMarketResponse["rules"],
  moves: PlotMarketMoves,
): HTMLButtonElement {
  const button = rowButton("Take back", title);
  confirmTwice(button, `Tap again: the ${coins(rules.listingFee)} aren't returned`, () =>
    moves.unlist(button, at),
  );
  return button;
}

/** One plot for sale. */
function listingRow(
  l: PlotListingView,
  data: Data,
  me: string | null,
  world: WorldSnapshot | null,
  moves: PlotMarketMoves,
): HTMLLIElement {
  const { title } = plotTitles(l, [l.seller.name]);
  const action = listingAction(l, me, data.you?.balance ?? null);
  let trail: HTMLButtonElement | null = null;
  if (action.kind === "take") trail = takeBack(l, title, data.rules, moves);
  else if (action.kind === "buy") {
    const buy = rowButton(action.text, title);
    buy.disabled = !action.can;
    buy.addEventListener("click", () => moves.buy(l, title));
    trail = buy;
  }
  const more =
    action.kind === "take"
      ? null
      : reportMenu(
          { kind: "plot_listing", id: `${l.px},${l.py}`, label: "plot for sale" },
          { id: `plot-listing-more-${l.px}-${l.py}`, text: "Report this plot" },
        );
  return itemRow({
    className: "plot-sale",
    attrs: { "data-plot": `${l.px},${l.py}` },
    lead: thumb(world, l, title),
    name: title,
    lines: [
      h("span", {}, `${coins(l.price)} from `, personLink(l.seller)),
      listingFacts(l, world?.day),
      seeIt(l),
    ],
    trail: trail || more ? h("span", { class: "cluster listing-trail" }, trail, more) : null,
  });
}

function sellButton(at: { px: number; py: number }, name: string | null, moves: PlotMarketMoves) {
  const sell = rowButton("Sell", name ?? "your plot");
  sell.addEventListener("click", () => moves.sell(at, name));
  return sell;
}

/** One plot of yours: for sale at its price with Take back, or why it can't be sold yet. */
function ownRow(
  plot: OwnPlot,
  data: Data,
  world: WorldSnapshot | null,
  moves: PlotMarketMoves,
): HTMLLIElement {
  const listing = data.you?.listings.find((l) => l.px === plot.px && l.py === plot.py);
  const named = world?.plots.find((p) => p.px === plot.px && p.py === plot.py)?.name;
  const name = listing?.name ?? named ?? null;
  const title = name ?? "Your plot";
  const line = ownPlotLine(plot, listing, data.rules);
  return itemRow({
    className: "plot-own",
    attrs: { "data-plot": `${plot.px},${plot.py}` },
    lead: thumb(world, plot, title),
    name: title,
    lines: [line, seeIt(plot)],
    trail: plot.listed
      ? takeBack(plot, title, data.rules, moves)
      : plot.canList
        ? sellButton(plot, name, moves)
        : null,
  });
}

/**
 * The section, or null while the world sells no plots. `world` is the snapshot when the page asked
 * for it (only when there's a plot to draw), for the pictures, the names, and today's day.
 */
export function plotMarketSection(
  data: PlotMarketResponse,
  o: { me: string | null; world: WorldSnapshot | null; moves: PlotMarketMoves },
): HTMLElement | null {
  if (!data.plotMarket) return null;
  const open = data as Data;
  const { listings } = open.plotMarket;
  const rows = listings.map((l) => listingRow(l, open, o.me, o.world, o.moves));
  const own = (open.you?.plots ?? []).map((p) => ownRow(p, open, o.world, o.moves));
  return h(
    "section",
    { class: "stack market-section plot-sales", attrs: { "aria-labelledby": "plots" } },
    h("h2", { class: "section-title", attrs: { id: "plots" }, text: "Plots for sale" }),
    rows.length > 0
      ? itemRows(rows, { className: "plot-sale-rows" })
      : emptyNote(
          "No plots for sale",
          "When a resident lists a plot, it shows here. Claiming an empty plot is still free.",
        ),
    open.you ? null : h("p", { class: "hint", text: "Join to buy a plot." }),
    own.length > 0
      ? h(
          "div",
          { class: "stack tight" },
          h("h3", { class: "card-title", attrs: { id: "plots-yours" }, text: "Your plots" }),
          itemRows(own, { className: "plot-own-rows" }),
        )
      : null,
  );
}

/** Whether the section draws a plot, so the page asks for the world snapshot to draw it with. */
export const drawsAPlot = (data: PlotMarketResponse): boolean =>
  (data.plotMarket?.listings.length ?? 0) > 0 || (data.you?.plots.length ?? 0) > 0;
