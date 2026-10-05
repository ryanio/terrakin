import {
  type AuthorView,
  GALLERIES_MAX,
  type GalleriesResponse,
  type GalleryPieceView,
  type GalleryView,
} from "@terrakin/protocol";
import { displaysOf, parseKey, type WorldState } from "@terrakin/sim";
import { goodView } from "./items";

/**
 * `GET /v1/galleries` (RFC 0005 step 3): plots opened as galleries and what's on display on each,
 * read from the world. Public, like the world: what's on display shows to everyone who passes.
 */

type Authors = (id: string) => AuthorView | undefined;

export function galleriesView(
  state: WorldState,
  author: Authors,
  options: { resident?: string | undefined; hidden?: (id: string) => boolean } = {},
): GalleriesResponse {
  const { plotSize } = state.config;
  const hidden = options.hidden ?? (() => false);
  // What's on display, by the plot it stands on.
  const byPlot = new Map<string, GalleryPieceView[]>();
  for (const [key, d] of Object.entries(displaysOf(state))) {
    const [x, y] = parseKey(key);
    const plot = `${Math.floor(x / plotSize)},${Math.floor(y / plotSize)}`;
    const by = author(d.by);
    const list = byPlot.get(plot) ?? [];
    list.push({ x, y, good: goodView(d.good, author), ...(by ? { by } : {}), day: d.day });
    byPlot.set(plot, list);
  }
  const galleries: GalleryView[] = [];
  for (const [key, plot] of Object.entries(state.plots)) {
    if (!plot.gallery || hidden(plot.ownerId)) continue;
    const residents = [plot.ownerId, ...(plot.coOwners ?? [])];
    if (options.resident !== undefined && !residents.includes(options.resident)) continue;
    const owner = author(plot.ownerId);
    if (!owner) continue;
    const pieces = (byPlot.get(key) ?? []).sort(
      (a, b) =>
        (b.good.admired ?? 0) - (a.good.admired ?? 0) || b.day - a.day || a.y - b.y || a.x - b.x,
    );
    galleries.push({
      px: plot.px,
      py: plot.py,
      owner,
      coOwners: (plot.coOwners ?? []).flatMap((id) => {
        const a = author(id);
        return a ? [a] : [];
      }),
      pieces,
      admired: pieces.reduce((n, p) => n + (p.good.admired ?? 0), 0),
    });
  }
  galleries.sort(
    (a, b) =>
      b.admired - a.admired || b.pieces.length - a.pieces.length || a.py - b.py || a.px - b.px,
  );
  return { galleries: galleries.slice(0, GALLERIES_MAX) };
}
