/**
 * Where tea shows in the world (RFC 0047): a teapot with steam on the host's table, or by their
 * hearth, while an event with tea out is on. Drawing only, from the mirror: the server says which
 * events have tea (`tea` on the snapshot's events, and `dish_brought`). Pure, so tests pin it.
 */
import { type BlockKind, type Tile, tileKey } from "@terrakin/sim";

/** A teapot to draw: its tile, and whether it stands on a table. */
export interface TeaSpot {
  x: number;
  y: number;
  table: boolean;
}

/** What `teaSpots` reads of the mirror. */
export interface TeaFacts {
  plotSize: number;
  events: Iterable<{ status: string; host: string; px: number; py: number; tea?: true }>;
  /** The ground floor's blocks, by tile key. */
  blocks: ReadonlyMap<string, BlockKind>;
  hearthOf(id: string): Tile | null | undefined;
}

/** The tiles round a hearth, the nearest sides first, then the corners. */
const AROUND: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * A teapot for each live event with tea out: on the first table on the event's plot (north to
 * south, west to east), else on an open tile beside the host's hearth there, else at the plot's
 * middle.
 */
export function teaSpots(f: TeaFacts): TeaSpot[] {
  const spots: TeaSpot[] = [];
  for (const e of f.events) {
    if (e.status !== "live" || !e.tea) continue;
    const x0 = e.px * f.plotSize;
    const y0 = e.py * f.plotSize;
    const onPlot = (x: number, y: number) =>
      x >= x0 && y >= y0 && x < x0 + f.plotSize && y < y0 + f.plotSize;
    let table: Tile | undefined;
    for (let y = y0; y < y0 + f.plotSize && !table; y++) {
      for (let x = x0; x < x0 + f.plotSize && !table; x++) {
        if (f.blocks.get(tileKey(x, y)) === "table") table = { x, y };
      }
    }
    if (table) {
      spots.push({ ...table, table: true });
      continue;
    }
    const hearth = f.hearthOf(e.host);
    const by =
      hearth && onPlot(hearth.x, hearth.y)
        ? AROUND.map(([dx, dy]) => ({ x: hearth.x + dx, y: hearth.y + dy })).find(
            (t) => onPlot(t.x, t.y) && !f.blocks.has(tileKey(t.x, t.y)),
          )
        : undefined;
    const mid = { x: x0 + Math.floor(f.plotSize / 2), y: y0 + Math.floor(f.plotSize / 2) };
    spots.push({ ...(by ?? mid), table: false });
  }
  return spots;
}
