/**
 * How furnished a plot's home is and what its walls are made of, in words for its card on the
 * Visit page (RFC 0050, RFC 0051): "14 pieces of furniture, 9 things on show, 12 fine walls", or as
 * much of it as there is. Pure and tested, and imported only by the Visit page and the plot market,
 * so the first load never carries it.
 */
import type { PlotView } from "@terrakin/protocol";
import { plural } from "@terrakin/ui/format";

/** The line, or null when the server sent no counts or they're all 0. */
export function furnishedLine(plot: Pick<PlotView, "furnished" | "walls">): string | null {
  const f = plot.furnished;
  const parts = [
    f && f.pieces > 0 ? plural(f.pieces, "piece of furniture", "pieces of furniture") : "",
    f && f.onShow > 0 ? plural(f.onShow, "thing on show", "things on show") : "",
    gradedWallsLine(plot.walls) ?? "",
  ].filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * A home's graded walls (RFC 0051), from the server's counts: "12 fine walls, 1 masterwork wall".
 * Null when it has none.
 */
export function gradedWallsLine(walls: PlotView["walls"]): string | null {
  if (!walls) return null;
  const parts = [
    walls.fine > 0 ? plural(walls.fine, "fine wall", "fine walls") : "",
    walls.masterwork > 0 ? plural(walls.masterwork, "masterwork wall", "masterwork walls") : "",
  ].filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join(", ");
}
