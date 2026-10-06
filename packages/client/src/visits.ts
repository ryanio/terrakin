/**
 * Plots worth visiting (RFC 0020), the pure parts: which plots the home wall's strip shows, which
 * plot "Next plot" goes to, the words on a plot card, and when a plot's name shows on the map
 * (decision 0121). Tested in `visits.test.ts`.
 */
import type { PlotView } from "@terrakin/protocol";
import { canBuildOn, plotKey } from "@terrakin/sim";
import { plural } from "@terrakin/ui/format";

const DAY_MS = 24 * 60 * 60_000;

/**
 * When the home wall shows "Plots to visit". Like the townsfolk card (decision 0034), it counts
 * real residents' plots only and stays quiet while there's little to show.
 */
export const VISIT_STRIP = {
  /** Plots worth a look it needs before it shows at all. */
  min: 3,
  /** The most it shows. */
  max: 4,
  /** A plot that changed within this many days is fresh. */
  freshDays: 7,
  /** A bare starter hut's blocks: a plot needs more than this to be worth a look. */
  starterBlocks: 15,
} as const;

/** Whether `me` lives on a plot: they own it, or it's shared with them (the sim's own rule). */
export function isMine(plot: Pick<PlotView, "owner" | "coOwners">, me: string | null): boolean {
  if (me === null) return false;
  return canBuildOn({ ownerId: plot.owner.id, coOwners: plot.coOwners.map((c) => c.id) }, me);
}

/**
 * Whether a plot is worth a look: something built beyond a bare starter hut, and it changed this
 * week, or someone came by or admired it.
 */
export function worthAVisit(plot: PlotView, now: number): boolean {
  if (plot.blocks <= VISIT_STRIP.starterBlocks) return false;
  const changed = plot.changedAt === null ? Number.NaN : Date.parse(plot.changedAt);
  const fresh = now - changed <= VISIT_STRIP.freshDays * DAY_MS;
  return fresh || plot.admirers > 0 || plot.visitors > 0;
}

/**
 * The plots the home wall's strip shows, in the order given (newest change first): real
 * residents' plots worth a look, never your own. Empty while fewer than `VISIT_STRIP.min`
 * qualify, so a quiet town shows nothing rather than a row of bare huts.
 */
export function stripPlots(plots: readonly PlotView[], me: string | null, now: number): PlotView[] {
  const picks = plots.filter((p) => !p.owner.townsfolk && !isMine(p, me) && worthAVisit(p, now));
  return picks.length < VISIT_STRIP.min ? [] : picks.slice(0, VISIT_STRIP.max);
}

/**
 * Where "Next plot" goes from the plot at `at`: the next one in `plots` that isn't yours and
 * isn't in `passed` (plots the server turned a visit down for, by `plotKey`), round to the first
 * after the last. Null when there's no other plot to visit.
 */
export function nextPlot(
  plots: readonly PlotView[],
  at: { px: number; py: number } | null,
  me: string | null,
  passed: ReadonlySet<string> = new Set(),
): PlotView | null {
  const open = plots.filter((p) => !isMine(p, me) && !passed.has(plotKey(p.px, p.py)));
  const i = at ? open.findIndex((p) => p.px === at.px && p.py === at.py) : -1;
  const next = open[(i + 1) % Math.max(open.length, 1)];
  if (!next || (at && next.px === at.px && next.py === at.py)) return null;
  return next;
}

/** "Admired by 2 neighbors, 5 visitors this week", or as much of it as there is. */
export function weekLine(plot: Pick<PlotView, "admirers" | "visitors">): string {
  const admired =
    plot.admirers > 0 ? `Admired by ${plural(plot.admirers, "neighbor", "neighbors")}` : "";
  const came = plot.visitors > 0 ? plural(plot.visitors, "visitor", "visitors") : "";
  if (admired && came) return `${admired}, ${came} this week`;
  if (admired || came) return `${admired || came} this week`;
  return "No visitors yet this week";
}

/**
 * "Ivy's plot", "Ivy and Sam's plot", "Ivy, Sam, and Lee's plot": the owner first, then the
 * residents it's shared with. Names are residents' words, so this goes in as text.
 */
export function plotName(names: readonly string[]): string {
  const who =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
  return `${who}'s plot`;
}

/**
 * What a plot is called on a card (decision 0121): its own name as the title, with whose plot it
 * is under it, or whose plot it is alone while it has no name. Both are residents' words: text.
 */
export function plotTitles(
  plot: { name?: string | undefined },
  names: readonly string[],
): { title: string; whose: string | null } {
  const whose = plotName(names);
  return plot.name ? { title: plot.name, whose } : { title: whose, whose: null };
}

/**
 * When a plot's name shows over it on the map (decision 0121): in full from on it or right beside
 * it, fading out by `far` tiles away, so on a phone, where the map shows about 13 tiles across,
 * it's the plots around you. Drawn at `zoomed` pixels a tile or more (a tablet or a desktop
 * screen), every plot on screen has room for its name, so they all show.
 */
export const PLOT_LABEL = { near: 2, far: 6, zoomed: 44 } as const;

/**
 * How strongly a plot's name shows on the map, 0 to 1, `tilesAway` from the plot (0 on it), with
 * the map drawn at `scale` pixels a tile.
 */
export function plotLabelFade(tilesAway: number, scale: number): number {
  if (scale >= PLOT_LABEL.zoomed || tilesAway <= PLOT_LABEL.near) return 1;
  if (tilesAway >= PLOT_LABEL.far) return 0;
  return (PLOT_LABEL.far - tilesAway) / (PLOT_LABEL.far - PLOT_LABEL.near);
}
