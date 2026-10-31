import { coinCount as coins, isWhole, oneTimeSwitch, refuse } from "./check";
import { hallAt } from "./circles";
import { isTownsfolk, movePurse, moveTreasury, sameHousehold } from "./economy";
import { eventsAt } from "./events";
import { parseKey, plotKey } from "./keys";
import { landOfPlot } from "./lands";
import { MARKET, marketFee } from "./market";
import { potsOf } from "./pottery";
import { isSide, SIDE_STEP } from "./surfaces";
import type {
  Command,
  EconomyState,
  Plot,
  PlotListing,
  PlotMarketState,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";
import { plotOf, plotsOwnedBy } from "./world";

/**
 * The plot market ([RFC 0039](../../../docs/rfcs/0039-plot-market.md), decision 0344): a plot's
 * owner lists it for coins with `list_plot`, takes it back with `unlist_plot`, and another
 * resident buys it with `buy_plot`, the item market's shape with the plot itself as the escrow.
 *
 * **A listed plot is frozen.** Nothing on it changes until it sells or is taken back: no block
 * placed or removed, no flooring laid or lifted, no crop planted or harvested, no floor or roof, no
 * hearth set, no share given or taken, no name, no display, no event, no hall, and no release. So
 * the plot a buyer pays for is the plot they looked at, and a seller can't strip it in between.
 * Every rule that changes a plot asks `plotListedProblem`, and `plot-market.test.ts` tries each of
 * them on a listed plot, because a rule that forgets to ask compiles and passes everything else.
 *
 * Everything fixed to the land moves with it, because none of it moves at all: blocks, ground,
 * floors, crops and the roof are keyed by tile or kept on the plot's record, and only the record's
 * owner changes. What belongs to a person does not: every hearth on the plot but the buyer's is
 * cleared at the sale, as `release` clears it, and co-owners lose their share. Coins go from buyer to seller less
 * `marketFee`, which goes to the treasury; the listing fee is burned. Nothing is minted.
 *
 * Nothing here runs until the server sends `open_plot_market`, which needs the item market open
 * and a second land, so free land exists whenever prices do, and raises the plot cap. Before it
 * every command here is refused, so older logs replay to the hash they always had. After it `claim`
 * and `settle` still take only a first plot (`claimLimit`), so the plots past it are bought.
 */

/** The numbers (RFC 0039's decisions of 2026-10-21). Changing one needs a logged switch. */
export const PLOTS = {
  /** What listing a plot costs. Burned, and kept if the listing is taken back. */
  listingFee: 25,
  /** World days after a plot is claimed or bought before it may be listed. */
  settleDays: 14,
  /**
   * The most plots a resident may own that `open_plot_market` takes. The cap it logs never comes
   * down, so a slip in the switch would stay for good.
   */
  capMax: 3,
} as const;

type Mutation = () => WorldEvent[];
export type PlotMarketChecked = Mutation | Rejection;

/** The listing on plot (px, py), or undefined when it isn't for sale. */
export function plotListing(state: WorldState, px: number, py: number): PlotListing | undefined {
  return state.plotMarket?.listings[plotKey(px, py)];
}

/**
 * Why nothing on plot (px, py) may change, or null: it is for sale, and frozen until it sells or
 * is taken back. Every rule that changes a plot asks this first.
 */
export function plotListedProblem(state: WorldState, px: number, py: number): Rejection | null {
  if (!plotListing(state, px, py)) return null;
  return refuse(
    "plot_listed",
    `That plot is for sale, so nothing on it changes until it sells. Its owner can take it back with {"type": "unlist_plot", "px": ${px}, "py": ${py}}.`,
  );
}

/** `plotListedProblem` for the plot a tile is on. */
export const tileListedProblem = (state: WorldState, x: number, y: number): Rejection | null => {
  const { px, py } = plotOf(state.config, x, y);
  return plotListedProblem(state, px, py);
};

interface Open {
  plots: PlotMarketState;
  econ: EconomyState;
  day: number;
}

/** The checks every resident's plot-market command shares: open, joined, and not townsfolk. */
function opened(state: WorldState, actor: ResidentId): Open | Rejection {
  const { plotMarket: plots, economy: econ, day } = state;
  if (!plots || !econ || day === undefined) {
    return refuse("market_closed", "Plots aren't for sale in this world yet.");
  }
  if (!state.residents[actor]) return refuse("not_joined", "Join the world first.");
  if (isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk don't trade. Their plots are the town's.");
  }
  return { plots, econ, day };
}

/** The plot at (px, py) if `actor` owns it, or why not. */
function ownPlot(state: WorldState, actor: ResidentId, px: unknown, py: unknown): Plot | Rejection {
  if (!isWhole(px) || !isWhole(py)) return refuse("out_of_bounds", "Name a plot by its px and py.");
  const plot = state.plots[plotKey(px, py)];
  if (!plot || plot.ownerId !== actor) {
    return refuse("not_your_plot", "You can only sell a plot you own.");
  }
  return plot;
}

const isPlot = (p: Plot | Rejection): p is Plot => "ownerId" in p;

// ---------- server input ----------

/**
 * `open_plot_market {maxPlotsPerResident}`, which only TOWN_ACTOR sends. Needs the item market open
 * and a second land, so a newcomer can always claim free land while downtown has a price. It sets
 * the plot cap in the same input, so a world can't hold more plots a resident than its log says,
 * and never lowers it, since someone may already own that many.
 */
export function checkOpenPlotMarket(
  state: WorldState,
  command: Extract<Command, { type: "open_plot_market" }>,
): PlotMarketChecked {
  const cap = command.maxPlotsPerResident;
  return oneTimeSwitch({
    on: state.plotMarket,
    already: "Plots are already for sale.",
    notYet: () => {
      if (!state.market) return refuse("not_due", "Plots go on sale once the market has opened.");
      if (!state.lands?.list.length) {
        return refuse("not_due", "Plots go on sale once a second land has opened.");
      }
      const now = state.config.maxPlotsPerResident;
      if (!isWhole(cap) || cap < now || cap > Math.max(now, PLOTS.capMax)) {
        return refuse(
          "invalid_amount",
          `The plot cap is a whole number from today's ${now} to ${Math.max(now, PLOTS.capMax)}. It never comes down.`,
        );
      }
      return null;
    },
    turnOn: () => {
      state.plotMarket = { listings: {} };
      state.config.maxPlotsPerResident = cap;
    },
    event: { type: "plot_market_opened", maxPlotsPerResident: cap },
  });
}

/**
 * Why a resident who owns `owned` plots gets no other by `claim` or `settle` once plots are for
 * sale: they hold the most a resident can, or a plot past the first comes only by buying it.
 */
export function anotherPlotWords(state: WorldState, owned: number): string {
  const cap = state.config.maxPlotsPerResident;
  if (owned < cap) {
    return "Only a first plot is free to claim. Another comes only by buying it: GET /v1/plot-market lists the plots for sale.";
  }
  return cap === 1
    ? "You already own a plot, and a resident owns one here."
    : `You already own ${cap} plots, the most a resident can.`;
}

// ---------- listing ----------

/**
 * `list_plot {px, py, price}`: put a plot you own up for sale, for the whole plot as it stands.
 * Downtown only, never within `PLOTS.settleDays` of claiming or buying it, never a circle's hall,
 * never with anything on display or any event booked there. Costs `PLOTS.listingFee`, burned.
 */
export function checkListPlot(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "list_plot" }>,
): PlotMarketChecked {
  const open = opened(state, actor);
  if ("code" in open) return open;
  const { plots, econ, day } = open;
  const found = ownPlot(state, actor, command.px, command.py);
  if (!isPlot(found)) return found;
  const plot = found;
  const { px, py } = plot;
  const { price } = command;
  if (!isWhole(price) || price < 1 || price > MARKET.priceMax) {
    return refuse(
      "invalid_amount",
      `A price is a whole number of coins from 1 to ${MARKET.priceMax}.`,
    );
  }
  if (plotListing(state, px, py)) {
    return refuse(
      "plot_listed",
      "That plot is already for sale. Take it back with unlist_plot to change its price.",
    );
  }
  if (landOfPlot(state, px, py)) {
    return refuse(
      "not_eligible",
      "Only downtown plots can be sold for now, and this one is across the water.",
    );
  }
  const since = Math.max(plot.claimedDay ?? 0, plot.boughtDay ?? 0);
  if (day < since + PLOTS.settleDays) {
    const left = since + PLOTS.settleDays - day;
    return refuse(
      "not_yet",
      `You can sell this plot in ${left === 1 ? "1 day" : `${left} days`}. A plot waits ${PLOTS.settleDays} days after it's claimed or bought before it can be sold.`,
    );
  }
  if (hallAt(state, px, py)) {
    return refuse(
      "not_eligible",
      "That plot is a circle's hall. Its steward moves the hall first.",
    );
  }
  if (eventsAt(state, px, py).length > 0) {
    return refuse(
      "not_eligible",
      "An event is booked on that plot, and guests said they'd come. Call it off first.",
    );
  }
  if (displayOnPlot(state, px, py)) {
    return refuse(
      "not_eligible",
      "Something is on display on that plot, and it stays whoever put it up. Take it down first.",
    );
  }
  // A pot set down (RFC 0047) is someone's thing too.
  const { plotSize } = state.config;
  if (
    potsOf(state).some(
      (p) => Math.floor(p.x / plotSize) === px && Math.floor(p.y / plotSize) === py,
    )
  ) {
    return refuse(
      "not_eligible",
      "A pot is set down on that plot, and it stays whoever set it down. Take it up first with remove.",
    );
  }
  // So is a pot firing in a kiln there: only someone who can build on the plot opens the kiln, so
  // after a sale its loader could never take it out.
  const firing = Object.keys(state.items?.firings ?? {}).find((key) => {
    const [x, y] = parseKey(key);
    return Math.floor(x / plotSize) === px && Math.floor(y / plotSize) === py;
  });
  if (firing) {
    const [x, y] = parseKey(firing);
    return refuse(
      "not_eligible",
      `A pot is firing in the kiln at ${x}, ${y}, and it stays whoever loaded it. Take it out with harvest once it's ready, then list the plot.`,
    );
  }
  const have = econ.coins[actor] ?? 0;
  if (have < PLOTS.listingFee) {
    return refuse(
      "not_enough_coins",
      `Listing a plot costs ${coins(PLOTS.listingFee)}, and you have ${coins(have)}.`,
    );
  }
  const at = { seq: state.seq + 1, day };
  return () => {
    plots.listings[plotKey(px, py)] = { px, py, seller: actor, price, day, listed: at.seq };
    econ.burned += PLOTS.listingFee;
    return [
      movePurse(econ, actor, -PLOTS.listingFee, "plot_listing_fee", at),
      { type: "plot_listed", px, py, seller: actor, price },
    ];
  };
}

/**
 * Why `actor` can't list plot (px, py) now, or null when they can: `list_plot`'s own checks, every
 * one but the price, which a reader picks. `GET /v1/plot-market` answers `canList` from it.
 */
export function listPlotProblem(
  state: WorldState,
  actor: ResidentId,
  px: number,
  py: number,
): Rejection | null {
  const checked = checkListPlot(state, actor, { type: "list_plot", px, py, price: 1 });
  return typeof checked === "function" ? null : checked;
}

/** Every plot for sale, newest listing first, then north to south and west to east. */
export function plotListings(state: WorldState): PlotListing[] {
  return Object.values(state.plotMarket?.listings ?? {}).sort(
    (a, b) => b.day - a.day || a.py - b.py || a.px - b.px,
  );
}

/** What a sale at `price` moves: the fee to the treasury, and what reaches the seller. */
export interface PlotSale {
  price: number;
  /** `marketFee`, never more than the price. */
  fee: number;
  sellerGets: number;
  /**
   * Everyone whose hearth is on the plot, which the sale clears: its seller's, or a co-owner's. Never
   * the buyer's: a co-owner who buys the plot they live on keeps their hearth.
   */
  hearths: ResidentId[];
  /** Everyone the plot is shared with, who loses their share at the sale. Never the buyer. */
  shared: ResidentId[];
}

/**
 * What selling plot (px, py) at `price` to `buyer` would move and clear, as `buy_plot` does it.
 * Without a buyer (a listing, before anyone buys), every hearth on the plot.
 */
export function plotSale(
  state: WorldState,
  px: number,
  py: number,
  price: number,
  buyer?: ResidentId,
): PlotSale {
  const fee = Math.min(marketFee(price), price);
  const hearths = Object.values(state.residents).flatMap((r) => {
    if (!r.hearth || r.id === buyer) return [];
    const p = plotOf(state.config, r.hearth.x, r.hearth.y);
    return p.px === px && p.py === py ? [r.id] : [];
  });
  const shared = (state.plots[plotKey(px, py)]?.coOwners ?? []).filter((id) => id !== buyer);
  return { price, fee, sellerGets: price - fee, hearths, shared };
}

/**
 * Whether anything stands on display on plot (px, py): on a pedestal or a frame, or on a surface or
 * a wall (RFC 0050). A surface or wall key may carry a floor before a colon and a side after the
 * tile; the tile alone says the plot.
 */
function displayOnPlot(state: WorldState, px: number, py: number): boolean {
  const { plotSize } = state.config;
  const items = state.items;
  const keys = [
    ...Object.keys(items?.displays ?? {}),
    ...Object.keys(items?.tops ?? {}),
    ...Object.keys(items?.hung ?? {}),
  ];
  const on = (x: number, y: number) =>
    Math.floor(x / plotSize) === px && Math.floor(y / plotSize) === py;
  // A wall face is seen from one tile and hangs on the next, so either one on the plot counts.
  return keys.some((key) => {
    const tile = key.includes(":") ? (key.split(":")[1] as string) : key;
    const [x, y, side] = tile.split(",") as [string, string, string | undefined];
    const tx = Number(x);
    const ty = Number(y);
    const [dx, dy] = isSide(side) ? SIDE_STEP[side] : [0, 0];
    return on(tx, ty) || on(tx + dx, ty + dy);
  });
}

/** `unlist_plot {px, py}`: take your plot back off the market. The listing fee stays burned. */
export function checkUnlistPlot(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "unlist_plot" }>,
): PlotMarketChecked {
  const open = opened(state, actor);
  if ("code" in open) return open;
  const { plots } = open;
  const { px, py } = command;
  const listing = isWhole(px) && isWhole(py) ? plotListing(state, px, py) : undefined;
  if (!listing || listing.seller !== actor) {
    return refuse(
      "unknown_listing",
      "You have no plot for sale there. GET /v1/plot-market lists them.",
    );
  }
  return () => {
    delete plots.listings[plotKey(listing.px, listing.py)];
    return [{ type: "plot_unlisted", px: listing.px, py: listing.py, seller: actor }];
  };
}

// ---------- buying ----------

/**
 * `buy_plot {px, py}`: pay the price and take the plot as it stands. The seller gets the price less
 * `marketFee`, which goes to the treasury. A sale is exempt from the gift caps, since the plot is
 * real payment, and refused inside one household, which is the one shape that is only moving coins.
 */
export function checkBuyPlot(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "buy_plot" }>,
): PlotMarketChecked {
  const open = opened(state, actor);
  if ("code" in open) return open;
  const { plots, econ, day } = open;
  const { px, py } = command;
  const listing = isWhole(px) && isWhole(py) ? plotListing(state, px, py) : undefined;
  const plot = isWhole(px) && isWhole(py) ? state.plots[plotKey(px, py)] : undefined;
  if (!listing || !plot) {
    return refuse(
      "unknown_listing",
      "That plot isn't for sale. GET /v1/plot-market lists the ones that are.",
    );
  }
  const { seller, price } = listing;
  if (seller === actor) {
    return refuse(
      "own_listing",
      `That's your own plot. Take it back with {"type": "unlist_plot", "px": ${px}, "py": ${py}}.`,
    );
  }
  // The listing and the price the buyer saw are what they agreed to. A plot taken back and listed
  // again is another listing, even at the same price: while it was off the market its seller could
  // change what stands on it, so a buy meant for the old one never goes through on the new.
  if (!isWhole(command.listed) || !isWhole(command.price)) {
    return refuse(
      "invalid_amount",
      'Send the listing you saw, as "listed", and its price, as "price", from GET /v1/plot-market.',
    );
  }
  if (command.listed !== listing.listed) {
    return refuse(
      "listing_changed",
      "That plot was taken back and listed again since you looked, so what stands on it may have changed. Look at it again before you buy.",
    );
  }
  if (command.price !== price) {
    return refuse("price_changed", `That plot is ${coins(price)}, not ${coins(command.price)}.`);
  }
  if (sameHousehold(state, actor, seller)) {
    return refuse(
      "not_eligible",
      "You and the seller are one household, and a sale inside one moves no land anyone else could have had.",
    );
  }
  const owned = plotsOwnedBy(state, actor).length;
  if (owned >= state.config.maxPlotsPerResident) {
    return refuse("plot_limit", anotherPlotWords(state, owned));
  }
  const have = econ.coins[actor] ?? 0;
  if (have < price) {
    return refuse("not_enough_coins", `That plot is ${coins(price)}, and you have ${coins(have)}.`);
  }
  const sale = plotSale(state, px, py, price, actor);
  const { fee } = sale;
  const at = { seq: state.seq + 1, day };
  const hearthsHere = sale.hearths.flatMap((id) => state.residents[id] ?? []);
  const coOwners = plot.coOwners ?? [];
  return () => {
    delete plots.listings[plotKey(px, py)];
    const events: WorldEvent[] = [];
    for (const id of coOwners) events.push({ type: "plot_unshared", px, py, residentId: id });
    delete plot.coOwners;
    delete plot.sharedDay;
    for (const r of hearthsHere) {
      r.hearth = null;
      events.push({ type: "hearth_cleared", residentId: r.id });
    }
    plot.ownerId = actor;
    plot.boughtDay = day;
    events.push(movePurse(econ, actor, -price, "plot_buy", at, { with: seller }));
    if (price > fee) events.push(movePurse(econ, seller, price - fee, "plot_sale", at));
    events.push(moveTreasury(econ, fee, "plot_fee", at));
    events.push({ type: "plot_sold", px, py, seller, buyer: actor, price });
    return events;
  };
}

// ---------- staff ----------

/**
 * `remove_plot_listing {px, py}`, which only TOWN_ACTOR sends: staff took a plot off the market
 * after a report. It goes back to its seller, unfrozen, and the listing fee stays burned.
 */
export function checkRemovePlotListing(
  state: WorldState,
  command: Extract<Command, { type: "remove_plot_listing" }>,
): PlotMarketChecked {
  const { plotMarket: plots } = state;
  if (!plots) return refuse("market_closed", "Plots aren't for sale in this world yet.");
  const { px, py } = command;
  const listing = isWhole(px) && isWhole(py) ? plotListing(state, px, py) : undefined;
  if (!listing) return refuse("unknown_listing", "That plot isn't for sale.");
  return () => {
    delete plots.listings[plotKey(px, py)];
    return [{ type: "plot_listing_removed", px, py, seller: listing.seller }];
  };
}
