/**
 * Pure helpers for the world in 3D (decision 0060): which plots are loaded around you, who is drawn,
 * which tile a tap lands on, and how things glide. No three.js here, so it's tested without a GPU.
 * Scene coordinates are tile coordinates: tile (x, y) stands at scene (x, 0, y), north is -z.
 */
import {
  type BlockKind,
  type Crop,
  type Direction,
  groundTile,
  type Resident,
  type ResourceKind,
  type Scenery,
  STEP,
  tileKey,
  type WorldConfig,
} from "@terrakin/sim";
import {
  type Bounds,
  cropIn,
  displayOn,
  type LayoutCrop,
  type LayoutDisplay,
  plotBounds,
  type ShownGood,
} from "./layout";

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
  /** What's on display on its pedestals and frames, and what grows in its planters. */
  displays: LayoutDisplay[];
  crops: LayoutCrop[];
  /** Grass tufts and flowers on open ground, from the same palette the 2D map draws with. */
  tufts: { x: number; y: number; turn: number }[];
  flowers: { x: number; y: number; warm: boolean }[];
  /** Today's fallen branches and loose stones still lying there, from the sim's own spawn. */
  pickups: { x: number; y: number; kind: ResourceKind }[];
  /** Equal for two reads exactly when what's drawn is the same. */
  signature: string;
}

/** The parts of the mirror a chunk reads. */
export interface ChunkSource {
  config: WorldConfig;
  commons: { px: number; py: number };
  blocks: ReadonlyMap<string, BlockKind>;
  plots: ReadonlyMap<string, string>;
  displays?: ReadonlyMap<string, { good: ShownGood }>;
  crops?: ReadonlyMap<string, { crop: Crop; plantedDay: number; readyDay: number }>;
  day?: number | undefined;
  /** What lies on a tile to pick up today (`Mirror.pickupAt`). */
  pickupAt?(x: number, y: number): ResourceKind | null;
}

/** What stands on one tile, and the words for it in a chunk's signature. */
function tileThings(source: ChunkSource, x: number, y: number, hearths: ReadonlySet<string>) {
  const key = tileKey(x, y);
  const block = source.blocks.get(key);
  const hearth = hearths.has(key);
  const display = displayOn(block, x, y, source.displays?.get(key));
  const crop = cropIn(block, x, y, source.crops?.get(key), source.day);
  const parts: string[] = [];
  if (block) parts.push(`${key}:${block}`);
  if (hearth) parts.push(`${key}:hearth`);
  // The picture too: staff can remove a piece's picture while it stays up (picture_removed).
  if (display) parts.push(`${key}:shows:${display.good.id}:${display.good.media ?? ""}`);
  if (crop) parts.push(`${key}:${crop.crop}:${crop.done.toFixed(2)}`);
  // Same rule as the map and the sim: a pickup lies anywhere not built on, hearths too.
  const pickup = source.pickupAt?.(x, y) ?? null;
  if (pickup) parts.push(`${key}:${pickup}`);
  return { block, hearth, display, crop, pickup, parts };
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
  const displays: LayoutDisplay[] = [];
  const crops: LayoutCrop[] = [];
  const tufts: PlotChunk["tufts"] = [];
  const flowers: PlotChunk["flowers"] = [];
  const pickups: PlotChunk["pickups"] = [];
  const parts: string[] = [owner ?? ""];
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const at = tileThings(source, x, y, hearths);
      parts.push(...at.parts);
      if (at.block) blocks.push({ x, y, block: at.block });
      if (at.hearth) homes.push({ x, y });
      if (at.display) displays.push(at.display);
      if (at.crop) crops.push(at.crop);
      if (at.pickup) pickups.push({ x, y, kind: at.pickup });
      if (at.block || at.hearth) continue;
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
    displays,
    crops,
    tufts,
    flowers,
    pickups,
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
  for (let y = bounds.y0; y <= bounds.y1; y++)
    for (let x = bounds.x0; x <= bounds.x1; x++)
      parts.push(...tileThings(source, x, y, hearths).parts);
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

/**
 * How far to turn a figure (about y) so it faces the way it last walked, any of the eight. South
 * faces the camera.
 */
export function faceAngle(dir: Direction | undefined): number {
  if (!dir) return 0;
  const [dx, dy] = STEP[dir];
  return Math.atan2(dx, dy);
}

/** Quarter turns clockwise from north, seen from above: 0 north, 1 east, 2 south, 3 west. */
export type Quarter = 0 | 1 | 2 | 3;

const CLOCKWISE: readonly Direction[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/**
 * Which way is "away from the camera", snapped to the nearest of the four directions, given where
 * the camera stands relative to what it looks at (scene x and z). Exactly between two directions
 * (45 degrees off), it takes the clockwise one.
 */
export function cameraQuarter(dx: number, dz: number): Quarter {
  // Away from the camera is (-dx, -dz). North is -z and east +x, so this is the angle from north.
  const turns = Math.atan2(-dx, dz) / (Math.PI / 2);
  return (((Math.floor(turns + 0.5) % 4) + 4) % 4) as Quarter;
}

/**
 * A d-pad or arrow-key direction (up is "n", diagonals too) turned to the world direction it means
 * when "up" is `quarter`. The 2D map passes 0, so up stays north.
 */
export function turnDir(dir: Direction, quarter: Quarter): Direction {
  return CLOCKWISE[(CLOCKWISE.indexOf(dir) + quarter * 2) % 8] ?? dir;
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
