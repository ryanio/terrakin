/**
 * How furnished a plot's home is, in words for its card on the Visit page (RFC 0050): "14 pieces
 * of furniture, 9 things on show", or as much of it as there is. Pure and tested, and imported only
 * by the Visit page, so the first load never carries it.
 */
import type { PlotView } from "@terrakin/protocol";
import { plural } from "@terrakin/ui/format";

/** The line, or null when the server sent no counts or they're all 0. */
export function furnishedLine(plot: Pick<PlotView, "furnished">): string | null {
  const f = plot.furnished;
  if (!f) return null;
  const parts = [
    f.pieces > 0 ? plural(f.pieces, "piece of furniture", "pieces of furniture") : "",
    f.onShow > 0 ? plural(f.onShow, "thing on show", "things on show") : "",
  ].filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join(", ");
}
