/**
 * Pure helpers for the world in 3D (decision 0060): which plots are loaded around you, who is drawn,
 * which tile a tap lands on, and how things glide. No three.js here, so it's tested without a GPU.
 * Scene coordinates are tile coordinates: tile (x, y) stands at scene (x, 0, y), north is -z.
 */
import {
  type BlockKind,
  type Direction,
  groundTile,
  type Resident,
  type Scenery,
  tileKey,
  type WorldConfig,
} from "@terrakin/sim";
import { type Bounds, plotBounds } from "./layout";

/** How far around you the world is drawn, in tiles (Chebyshev, like reach). Fog hides the edge. */
export const VIEW_RADIUS = 12;
/** A loaded plot stays until you're this many tiles past the view radius, so edges don't flicker. */
export const KEEP_SLACK = 4;
/** At most this many residents are drawn, nearest first. You're always one of them. */
export const MAX_FIGURES = 24;
/** At most this many plots are built in one frame, so walking into new ground never hitches. */
export const BUILDS_PER_FRAME = 2;
/** The ground follows you in steps of this many tiles. */
export const GROUND_STEP = 4;

export interface Tile {
  x: number;
  y: number;
}

/** The plots (as plot coordinates) with any tile within `radius` of `focus`, inside the world. */
export function plotsAround(focus: Tile, radius: number, config: WorldConfig): Tile[] {
  const S = config.plotSize;
  const maxPx = config.width / S - 1;
  const maxPy = config.height / S - 1;
  const px0 = Math.max(0, Math.floor((focus.x - radius) / S));
  const px1 = Math.min(maxPx, Math.floor((focus.x + radius) / S));
  const py0 = Math.max(0, Math.floor((focus.y - radius) / S));
  const py1 = Math.min(maxPy, Math.floor((focus.y + radius) / S));
  const out: Tile[] = [];
  for (let py = py0; py <= py1; py++)
    for (let px = px0; px <= px1; px++) out.push({ x: px, y: py });
  return out;
}

/** Chebyshev distance between two tiles, the way reach and the view radius count. */
export function tileDistance(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Who to draw: online residents within `radius` of `focus`, nearest first, at most `max`. The
 * resident `me` is always first when online, even past the radius.
 */
export function figuresAround<R extends Pick<Resident, "id" | "x" | "y" | "online">>(
  residents: Iterable<R>,
  focus: Tile,
  me: string | undefined,
  radius = VIEW_RADIUS,
  max = MAX_FIGURES,
): R[] {
  let mine: R | undefined;
  const near: { r: R; d: number }[] = [];
  for (const r of residents) {
    if (!r.online) continue;
    if (r.id === me) {
      mine = r;
      continue;
    }
    const d = tileDistance(r, focus);
    if (d <= radius) near.push({ r, d });
  }
  near.sort((a, b) => a.d - b.d || (a.r.id < b.r.id ? -1 : 1));
  const out = near.map((n) => n.r);
  if (mine) out.unshift(mine);
  return out.slice(0, max);
}

/** What one plot of the world holds, read from the mirror, with a signature that changes with it. */
export interface PlotChunk {
  px: number;
  py: number;
  bounds: Bounds;
  owner: string | undefined;
  blocks: { x: number; y: number; block: BlockKind }[];
  hearths: Tile[];
  /** Grass tufts and flowers on open ground, from the same palette the 2D map draws with. */
  tufts: { x: number; y: number; turn: number }[];
  flowers: { x: number; y: number; warm: boolean }[];
  /** Equal for two reads exactly when what's drawn is the same. */
  signature: string;
}

/** The parts of the mirror a chunk reads. */
export interface ChunkSource {
  config: WorldConfig;
  commons: { px: number; py: number };
  blocks: ReadonlyMap<string, BlockKind>;
  plots: ReadonlyMap<string, string>;
}

/** Read one plot from the mirror. `hearths` holds every resident's hearth tile key. */
export function readChunk(
  source: ChunkSource,
  px: number,
  py: number,
  hearths: ReadonlySet<string>,
): PlotChunk {
  const bounds = plotBounds(source.config.plotSize, px, py);
  const owner = source.plots.get(`${px},${py}`);
  const inCommons = px === source.commons.px && py === source.commons.py;
  const blocks: PlotChunk["blocks"] = [];
  const homes: Tile[] = [];
  const tufts: PlotChunk["tufts"] = [];
  const flowers: PlotChunk["flowers"] = [];
  const parts: string[] = [owner ?? ""];
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const key = tileKey(x, y);
      const block = source.blocks.get(key);
      if (block) {
        blocks.push({ x, y, block });
        parts.push(`${key}:${block}`);
      }
      if (hearths.has(key)) {
        homes.push({ x, y });
        parts.push(`${key}:hearth`);
      }
      if (block || hearths.has(key)) continue;
      const scenery: Scenery | null = groundTile(source.config, x, y, inCommons).scenery;
      if (scenery?.kind === "tuft")
        tufts.push({ x: x + scenery.fx - 0.5, y: y + 0.2, turn: ((x * 7 + y * 13) % 63) / 10 });
      else if (scenery?.kind === "flower")
        flowers.push({
          x: x + scenery.fx - 0.5,
          y: y + scenery.fy - 0.5,
          warm: scenery.tone === 1,
        });
    }
  }
  return {
    px,
    py,
    bounds,
    owner,
    blocks,
    hearths: homes,
    tufts,
    flowers,
    signature: parts.join("|"),
  };
}

/** Just the signature of a plot, cheap enough to check on every change to the mirror. */
export function chunkSignature(
  source: ChunkSource,
  px: number,
  py: number,
  hearths: ReadonlySet<string>,
): string {
  const bounds = plotBounds(source.config.plotSize, px, py);
  const parts: string[] = [source.plots.get(`${px},${py}`) ?? ""];
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const key = tileKey(x, y);
      const block = source.blocks.get(key);
      if (block) parts.push(`${key}:${block}`);
      if (hearths.has(key)) parts.push(`${key}:hearth`);
    }
  }
  return parts.join("|");
}

/** Every resident's hearth, as tile keys. */
export function hearthKeys(residents: Iterable<Pick<Resident, "hearth">>): Set<string> {
  const out = new Set<string>();
  for (const r of residents) if (r.hearth) out.add(tileKey(r.hearth.x, r.hearth.y));
  return out;
}

/** The tile a point in the scene stands on. */
export function tileAtPoint(x: number, z: number): Tile {
  return { x: Math.round(x), y: Math.round(z) };
}

type Vec = readonly [number, number, number];

/** Where a ray meets the ground (y = `height`), or undefined if it never comes down to it. */
export function groundPoint(origin: Vec, dir: Vec, height = 0): Vec | undefined {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;
  if (dy >= -1e-6) return undefined;
  const t = (height - oy) / dy;
  if (t < 0) return undefined;
  return [ox + dx * t, height, oz + dz * t];
}

/**
 * The tile a ray hit: just past where it touched a surface, so a tap on a wall's face picks the
 * block it belongs to, not the open tile in front of it.
 */
export function tileOfHit(point: Vec, dir: Vec, step = 0.05): Tile {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return tileAtPoint(point[0] + (dir[0] / len) * step, point[2] + (dir[2] / len) * step);
}

/** How far to turn a figure (about y) so it faces the way it last walked. South faces the camera. */
export function faceAngle(dir: Direction | undefined): number {
  switch (dir) {
    case "e":
      return Math.PI / 2;
    case "n":
      return Math.PI;
    case "w":
      return -Math.PI / 2;
    default:
      return 0;
  }
}

/** The shortest turn from angle `a` to angle `b`, in (-PI, PI]. */
export function turnBetween(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Glide a value toward a target, frame-rate independent: `rate` is how quickly (per second) the
 * gap closes. Lands exactly once it's close, so a still scene stops asking for frames.
 */
export function approach(current: number, target: number, dt: number, rate: number): number {
  const next = current + (target - current) * (1 - Math.exp(-rate * dt));
  return Math.abs(target - next) < 1e-3 ? target : next;
}

/** Where the ground grid sits: the focus rounded to the step, so it's rebuilt only now and then. */
export function groundAnchor(focus: Tile, step = GROUND_STEP): Tile {
  return { x: Math.round(focus.x / step) * step, y: Math.round(focus.y / step) * step };
}

/** What the 3D view says it shows: who is nearby, a few names and how many more. */
export function nearbyLabel(names: readonly string[]): string {
  if (names.length === 0) return "World view in 3D";
  const few = names.slice(0, 4);
  const more = names.length - few.length;
  return `World view in 3D. Nearby: ${few.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
}
