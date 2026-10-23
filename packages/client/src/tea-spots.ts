/**
 * Where tea shows in the world (RFC 0047): a teapot with steam, in its teapot's glaze, on a table in
 * the event's area, or on the host's hearth, while an event with tea out is on. Drawing only, from
 * the mirror: the server says which events have tea (`tea` and `teaGlaze` on the snapshot's events,
 * and `dish_brought`). Pure, so tests pin it.
 */
import {
  type BlockKind,
  eventArea,
  type Glaze,
  inArea,
  type Tile,
  tileKey,
  type WorldConfig,
} from "@terrakin/sim";

/** A teapot to draw: its tile, what it stands on, and its glaze. */
export interface TeaSpot {
  x: number;
  y: number;
  /** A table, the host's hearth, or the open ground of an event with neither. */
  on: "table" | "hearth" | "ground";
  glaze: Glaze;
}

/** What `teaSpots` reads of the mirror. */
export interface TeaFacts {
  config: WorldConfig;
  events: Iterable<{
    status: string;
    host: string;
    px: number;
    py: number;
    tea?: true;
    teaGlaze?: Glaze;
  }>;
  /** The ground floor's blocks, by tile key. */
  blocks: ReadonlyMap<string, BlockKind>;
  hearthOf(id: string): Tile | null | undefined;
}

/**
 * A teapot for each live event with tea out: on the first table on the event's plot (north to
 * south, west to east), else in the ring round it, else on the host's hearth when it's in the area, never on a house's floor,
 * else on the open ground at the middle of the event's plot (the Commons has no hearth).
 */
export function teaSpots(f: TeaFacts): TeaSpot[] {
  const spots: TeaSpot[] = [];
  for (const e of f.events) {
    if (e.status !== "live" || !e.tea) continue;
    const glaze = e.teaGlaze ?? "bare";
    const area = eventArea(f.config, e.px, e.py);
    const size = f.config.plotSize;
    const onPlot = (x: number, y: number) =>
      Math.floor(x / size) === e.px && Math.floor(y / size) === e.py;
    // A table on the event's own plot first, then one in the ring round it, so a neighbor's
    // table over the fence is only used when the host has none.
    let table: Tile | undefined;
    for (const own of [true, false]) {
      for (let y = area.y0; y <= area.y1 && !table; y++) {
        for (let x = area.x0; x <= area.x1 && !table; x++) {
          if (onPlot(x, y) === own && f.blocks.get(tileKey(x, y)) === "table") table = { x, y };
        }
      }
    }
    if (table) {
      spots.push({ ...table, on: "table", glaze });
      continue;
    }
    const hearth = f.hearthOf(e.host);
    if (hearth && inArea(area, hearth.x, hearth.y)) {
      spots.push({ x: hearth.x, y: hearth.y, on: "hearth", glaze });
      continue;
    }
    const mid = { x: e.px * size + Math.floor(size / 2), y: e.py * size + Math.floor(size / 2) };
    spots.push({ ...mid, on: "ground", glaze });
  }
  return spots;
}
