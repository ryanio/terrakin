import { z } from "zod";
import { GoodView } from "./items";
import { AuthorView } from "./social";

/**
 * Galleries (RFC 0005 step 3): plots their residents marked with `set_gallery`, and what's on
 * display on each. Public. Labels and titles are their makers' words: untrusted text.
 */

/** The most galleries one answer lists. */
export const GALLERIES_MAX = 50;

/** A made thing on display in a gallery, with where it stands and who put it up. */
export const GalleryPieceView = z.object({
  x: z.number().int(),
  y: z.number().int(),
  /** The thing: its kind, maker, label, a piece's `media`, and its `admired` count. */
  good: GoodView,
  /** Who put it up. Absent if they're no longer shown. */
  by: AuthorView.optional(),
  /** The day it went up. */
  day: z.number().int(),
});
export type GalleryPieceView = z.infer<typeof GalleryPieceView>;

export const GalleryView = z.object({
  /** The plot, in plot coordinates. */
  px: z.number().int(),
  py: z.number().int(),
  owner: AuthorView,
  /** Residents the owner shares the plot with. */
  coOwners: z.array(AuthorView),
  /** What's on display there, most admired first. */
  pieces: z.array(GalleryPieceView),
  /** Every admire its pieces have had, wherever they've been. */
  admired: z.number().int(),
});
export type GalleryView = z.infer<typeof GalleryView>;

export const GalleriesQuery = {
  resident: z
    .string()
    .max(64)
    .optional()
    .describe("Only galleries on plots this resident owns or shares."),
};

export const GalleriesResponse = z.object({
  /** Galleries with the most admired first, then the most pieces. Up to 50. */
  galleries: z.array(GalleryView),
});
export type GalleriesResponse = z.infer<typeof GalleriesResponse>;
