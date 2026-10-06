/**
 * Plot names (decision 0121): a plot's owner, or a resident it's shared with, can give it a name,
 * like "Juniper's Lemon Grove". The name lives on the plot (`name`), with who set it (`namedBy`)
 * and the world's day it was set (`namedDay`), all absent until the first `name_plot`, so every log
 * from before names hashes as it did. `release` drops the plot's whole record, so the name goes
 * with the plot.
 *
 * A name changes once a world day, and each plot has `PLOT_NAMES.freeRenames` free renames for a
 * change that can't wait: one changes a name that's up on the day it last changed, and counts in
 * `freeRenamesUsed`, absent until the first. Every name an older log holds came on a day the plot
 * wasn't named yet, so none of them used one, and old logs hash as they did.
 *
 * A name is resident text. The sim checks its length; the server cleans and filters it before it's
 * logged, sends `plot_named` marked untrusted, and holds it back while staff hold its writer's
 * words back. Staff take a name down with the server-only `clear_plot_name`.
 */

import { refuse } from "./check";
import { plotKey } from "./keys";
import { own } from "./own";
import type { Command, Plot, Rejection, ResidentId, WorldEvent, WorldState } from "./types";
import { canBuildOn, isCommons, plotInBounds } from "./world";

/** The numbers (decision 0121). */
export const PLOT_NAMES = {
  /** The longest name, in characters. */
  max: 40,
  /**
   * Renames a plot has on top of the once-a-day limit, for a typo that shouldn't wait for the next
   * day. Each changes a name that's up on the day it last changed, and they don't come back.
   */
  freeRenames: 2,
} as const;

/** How many free renames a plot has left. */
export const freeRenamesLeft = (plot: Pick<Plot, "freeRenamesUsed">): number =>
  Math.max(0, PLOT_NAMES.freeRenames - (plot.freeRenamesUsed ?? 0));

/** "1 free rename", "2 free renames". */
const renamesWords = (n: number) => `${n} free rename${n === 1 ? "" : "s"}`;

type Mutation = () => WorldEvent[];
export type PlotNamesChecked = Mutation | Rejection;

/** A name as the sim keeps it, or why it can't be one. */
function nameOf(value: unknown): string | Rejection {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > PLOT_NAMES.max) {
    return refuse("invalid_name", `A plot's name is 1 to ${PLOT_NAMES.max} characters.`);
  }
  return name;
}

/** The claimed plot at (px, py), or why there's nothing there to name. */
function namedPlot(state: WorldState, px: number, py: number): Plot | Rejection {
  const { config } = state;
  if (!plotInBounds(config, px, py)) {
    return refuse("out_of_bounds", "That plot is outside the world.");
  }
  if (isCommons(config, px, py)) {
    return refuse("plot_is_commons", "The Commons belongs to everyone, so it keeps its own name.");
  }
  const plot = own(state.plots, plotKey(px, py));
  return plot ?? refuse("plot_unclaimed", "Nobody has claimed that plot.");
}

const isPlot = (value: Plot | Rejection): value is Plot => "ownerId" in value;

/**
 * Whether a plot's name can change today without a free rename: it wasn't named on the world's
 * `day`. A world that doesn't count days has no limit.
 */
const canRenameToday = (plot: Pick<Plot, "namedDay">, day: number | undefined) =>
  day === undefined || plot.namedDay !== day;

/** Why a plot named today can't take another name today, with the free renames it has left. */
function renameLimit(plot: Plot): Rejection {
  const left = freeRenamesLeft(plot);
  if (plot.name === undefined) {
    const kept =
      left > 0 ? ` It has ${renamesWords(left)} left, but those only change a name that's up.` : "";
    return refuse(
      "rename_limit",
      `This plot was named today and its name came down since, so a new name waits until after midnight UTC.${kept}`,
    );
  }
  return refuse(
    "rename_limit",
    "This plot's name already changed today and it has no free renames left, so its name changes once a day now. Try again after midnight UTC.",
  );
}

/**
 * `name_plot {px, py, name}`: name a plot you own or share, from anywhere. A name changes once a
 * world day, and a change on a day it already changed takes one of the plot's free renames, while
 * it has a name up and one left. `null` clears it, any time, and never makes room for another name
 * that day.
 */
export function checkNamePlot(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "name_plot" }>,
): PlotNamesChecked {
  const found = namedPlot(state, command.px, command.py);
  if (!isPlot(found)) return found;
  const plot = found;
  if (!canBuildOn(plot, actor)) {
    return refuse(
      "not_your_plot",
      "Only the plot's owner, or someone it's shared with, can name it.",
    );
  }
  const { px, py } = plot;
  if (command.name === null) {
    if (plot.name === undefined) return refuse("already_set", "That plot has no name to clear.");
    return () => {
      delete plot.name;
      delete plot.namedBy;
      return [{ type: "plot_named", px, py, name: null, by: actor }];
    };
  }
  const name = nameOf(command.name);
  if (typeof name !== "string") return name;
  if (name === plot.name) return refuse("already_set", "That's already its name.");
  const day = state.day;
  // Named today already: only a free rename changes it again today, and only while a name is up,
  // so a name that came down (cleared, or taken down by staff) still waits for tomorrow. No name
  // an older log holds came this way, since the limit refused them all.
  const free = !canRenameToday(plot, day);
  if (free && (plot.name === undefined || freeRenamesLeft(plot) === 0)) return renameLimit(plot);
  return () => {
    plot.name = name;
    plot.namedBy = actor;
    if (day !== undefined) plot.namedDay = day;
    if (free) plot.freeRenamesUsed = (plot.freeRenamesUsed ?? 0) + 1;
    return [
      {
        type: "plot_named",
        px,
        py,
        name,
        by: actor,
        ...(day === undefined ? {} : { day }),
        ...(free ? { freeRenamesLeft: freeRenamesLeft(plot) } : {}),
      },
    ];
  };
}

/**
 * `clear_plot_name {px, py}` (staff, through the server, after a report): the name comes down. The
 * day it was set stays, so its residents can't put another up the same day.
 */
export function checkClearPlotName(
  state: WorldState,
  command: Extract<Command, { type: "clear_plot_name" }>,
): PlotNamesChecked {
  const found = namedPlot(state, command.px, command.py);
  if (!isPlot(found)) return found;
  const plot = found;
  if (plot.name === undefined) return refuse("already_set", "That plot has no name.");
  const { px, py } = plot;
  return () => {
    delete plot.name;
    delete plot.namedBy;
    return [{ type: "plot_name_removed", px, py }];
  };
}

/** The names on plots `residentId` owns or named, as staff see them for a report on them. */
export function plotNamesOf(
  state: WorldState,
  residentId: ResidentId,
): { px: number; py: number; name: string; namedBy: ResidentId }[] {
  return Object.values(state.plots)
    .filter((p) => p.name !== undefined && (p.ownerId === residentId || p.namedBy === residentId))
    .sort((a, b) => a.py - b.py || a.px - b.px)
    .map((p) => ({
      px: p.px,
      py: p.py,
      name: p.name as string,
      namedBy: p.namedBy ?? p.ownerId,
    }));
}
