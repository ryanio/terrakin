import { z } from "zod";
import { AuthorView } from "./social";

/**
 * Plots worth visiting (RFC 0020): the plots residents live on, when each last changed, and how
 * many neighbors came by and admired it this week. Public. Names are residents' words: untrusted
 * text. The counts never say who.
 */

/** The rules for admiring a plot, and the week its counts cover. Days are UTC days. */
export const PLOT_ADMIRE = {
  /** How far from a plot's edge you can admire it, in tiles: on it, or beside it after a visit. */
  nearTiles: 1,
  /** Plots one resident can admire a UTC day. Each plot once a day. */
  perAdmirerPerDay: 10,
  /** Whole UTC days since joining before a resident can admire (0 is the day they joined). */
  minAgeDays: 1,
  /** How many UTC days `visitors` and `admirers` count, today included. */
  weekDays: 7,
} as const;

/** The most plots one answer lists. */
export const PLOTS_MAX = 100;

/** How `GET /v1/plots` orders plots. */
export const PLOT_SORTS = ["recent", "admired"] as const;
export const PlotSort = z.enum(PLOT_SORTS);
export type PlotSort = z.infer<typeof PlotSort>;

export const PlotView = z.object({
  /** The plot, in plot coordinates. */
  px: z.number().int(),
  py: z.number().int(),
  owner: AuthorView,
  /** Residents the owner shares the plot with. */
  coOwners: z.array(AuthorView),
  /**
   * When something on it last changed: a block or a path placed or taken away, a crop planted or picked,
   * a thing put on display or taken down, a hearth set, or the plot claimed. Before anything has,
   * the day it was claimed; null when that was before the world counted days.
   */
  changedAt: z.string().nullable(),
  /** Residents who visited it with `visit` in the last 7 UTC days, each counted once. */
  visitors: z.number().int(),
  /** Residents who admired it in the last 7 UTC days, each counted once. */
  admirers: z.number().int(),
  /** With a token: whether you admired it today (UTC). */
  admiredToday: z.boolean().optional(),
  /**
   * With a token, on October 31 (Halloween night, RFC 0022): whether you knocked at its door with
   * `trick_or_treat` tonight.
   */
  knockedToday: z.boolean().optional(),
  /** Blocks on it, decor and stations included. */
  blocks: z.number().int(),
  /** Things on display on its pedestals and frames. */
  displays: z.number().int(),
  /** Opened as a gallery with `set_gallery`. Absent otherwise. */
  gallery: z.literal(true).optional(),
});
export type PlotView = z.infer<typeof PlotView>;

export const PlotsQuery = {
  sort: PlotSort.optional().describe(
    "`recent` (the default): the newest change first. `admired`: the most admirers this week first.",
  ),
  limit: z
    .string()
    .regex(/^[1-9][0-9]{0,2}$/)
    .optional()
    .transform((v) => (v === undefined ? PLOTS_MAX : Math.min(PLOTS_MAX, Number(v))))
    .describe(`How many plots, 1 to ${PLOTS_MAX}. Default ${PLOTS_MAX}.`),
};

export const PlotsResponse = z.object({
  /** In the order asked for; ties go to the most visitors, then north to south, west to east. */
  plots: z.array(PlotView),
});
export type PlotsResponse = z.infer<typeof PlotsResponse>;

export const PlotResponse = z.object({ plot: PlotView });
export type PlotResponse = z.infer<typeof PlotResponse>;
