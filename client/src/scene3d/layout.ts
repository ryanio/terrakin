/**
 * Pure helpers for the 3D views: which plot to show for a resident, what sits on it, how dark each
 * ground corner is, and how to fit a resident's own model onto their plot. No three.js here, so
 * the math is tested without a GPU.
 */
import type { WorldSnapshot } from "@terrakin/protocol";
import type { BlockKind, ResidentColor, ResidentShape } from "@terrakin/sim";
import { isMediaUrl } from "../format";

/** Inclusive tile range. */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function plotBounds(plotSize: number, px: number, py: number): Bounds {
  return {
    x0: px * plotSize,
    y0: py * plotSize,
    x1: (px + 1) * plotSize - 1,
    y1: (py + 1) * plotSize - 1,
  };
}

export function inBounds(b: Bounds, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

/** How many tiles a tile sits outside the bounds (0 inside). Chebyshev, like reach. */
export function distanceOutside(b: Bounds, x: number, y: number): number {
  const dx = Math.max(b.x0 - x, 0, x - b.x1);
  const dy = Math.max(b.y0 - y, 0, y - b.y1);
  return Math.max(dx, dy);
}

/**
 * The plot a resident calls home: the one holding their hearth, else their first plot (north to
 * south, west to east). Undefined when they own none.
 */
export function homePlot(
  snapshot: WorldSnapshot,
  residentId: string,
): { px: number; py: number } | undefined {
  const owned = snapshot.plots
    .filter((p) => p.ownerId === residentId)
    .sort((a, b) => a.py - b.py || a.px - b.px);
  const resident = snapshot.residents.find((r) => r.id === residentId);
  const S = snapshot.config.plotSize;
  const hearth = resident?.hearth;
  const withHearth = hearth
    ? owned.find((p) => p.px === Math.floor(hearth.x / S) && p.py === Math.floor(hearth.y / S))
    : undefined;
  const pick = withHearth ?? owned[0];
  return pick ? { px: pick.px, py: pick.py } : undefined;
}

export interface LayoutBlock {
  x: number;
  y: number;
  block: BlockKind;
  /** True on the shown plot; false for a neighbor's block in the margin. */
  own: boolean;
  /** 0 on the plot, rising toward 1 at the edge of the margin, where neighbors melt into the haze. */
  fade: number;
}

export interface LayoutFigure {
  id: string;
  name: string;
  kind: "human" | "agent";
  color: ResidentColor;
  shape: ResidentShape;
  x: number;
  y: number;
  owner: boolean;
}

export interface PlotLayout {
  ownerId: string;
  ownerName: string;
  plot: { px: number; py: number };
  bounds: Bounds;
  size: number;
  /** The plot's middle in tile units (tile centers are whole numbers). */
  center: { x: number; y: number };
  /** Neighbor tiles shown around the plot. */
  margin: number;
  blocks: LayoutBlock[];
  hearth: { x: number; y: number } | null;
  figures: LayoutFigure[];
  /** Is this tile inside the world at all? */
  inWorld(x: number, y: number): boolean;
}

/**
 * Everything the 3D plot view draws, read from one snapshot. Undefined when the resident is
 * unknown or owns no plot. Residents on the plot are shown if they're online; the owner is always
 * home, standing on their own tile when they're on the plot, else beside the hearth.
 */
export function plotLayout(
  snapshot: WorldSnapshot,
  residentId: string,
  margin = 4,
): PlotLayout | undefined {
  const owner = snapshot.residents.find((r) => r.id === residentId);
  const plot = homePlot(snapshot, residentId);
  if (!owner || !plot) return undefined;
  const { plotSize, width, height } = snapshot.config;
  const bounds = plotBounds(plotSize, plot.px, plot.py);
  const outer: Bounds = {
    x0: bounds.x0 - margin,
    y0: bounds.y0 - margin,
    x1: bounds.x1 + margin,
    y1: bounds.y1 + margin,
  };

  const blocks: LayoutBlock[] = [];
  for (const b of snapshot.blocks) {
    if (!inBounds(outer, b.x, b.y)) continue;
    const d = distanceOutside(bounds, b.x, b.y);
    blocks.push({ x: b.x, y: b.y, block: b.block, own: d === 0, fade: d / (margin + 1) });
  }
  blocks.sort((a, b) => a.y - b.y || a.x - b.x);

  const hearth =
    owner.hearth && inBounds(bounds, owner.hearth.x, owner.hearth.y) ? owner.hearth : null;
  const solid = new Set(blocks.map((b) => `${b.x},${b.y}`));
  const figures: LayoutFigure[] = [];
  for (const r of snapshot.residents) {
    const isOwner = r.id === owner.id;
    const onPlot = inBounds(bounds, r.x, r.y);
    if (!isOwner && !(r.online && onPlot)) continue;
    const spot = onPlot ? { x: r.x, y: r.y } : homeSpot(bounds, hearth, solid);
    figures.push({
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      shape: r.shape,
      x: spot.x,
      y: spot.y,
      owner: isOwner,
    });
  }

  return {
    ownerId: owner.id,
    ownerName: owner.name,
    plot,
    bounds,
    size: plotSize,
    center: { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 },
    margin,
    blocks,
    hearth,
    figures,
    inWorld: (x, y) => x >= 0 && y >= 0 && x < width && y < height,
  };
}

/** Where an owner who's out stands: next to the hearth on a free tile, or the middle of the plot. */
function homeSpot(
  b: Bounds,
  hearth: { x: number; y: number } | null,
  solid: Set<string>,
): { x: number; y: number } {
  const free = (x: number, y: number) => inBounds(b, x, y) && !solid.has(`${x},${y}`);
  if (hearth) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      if (free(hearth.x + dx, hearth.y + dy)) return { x: hearth.x + dx, y: hearth.y + dy };
    }
  }
  const mid = { x: Math.floor((b.x0 + b.x1) / 2), y: Math.floor((b.y0 + b.y1) / 2) };
  if (free(mid.x, mid.y)) return mid;
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) if (free(x, y)) return { x, y };
  return mid;
}

/**
 * Soft ambient occlusion for a ground corner: the corner shared by tiles (cx - 1 .. cx, cy - 1 ..
 * cy). Each solid neighbor darkens it a little, so blocks sit in gentle pools of shade.
 * Returns a brightness from 1 (open) down to 0.6 (boxed in).
 */
export function cornerLight(solid: ReadonlySet<string>, cx: number, cy: number): number {
  let n = 0;
  for (const [x, y] of [
    [cx - 1, cy - 1],
    [cx, cy - 1],
    [cx - 1, cy],
    [cx, cy],
  ] as const) {
    if (solid.has(`${x},${y}`)) n++;
  }
  return 1 - n * 0.1;
}

/** Cheap integer hash for visual variety only (the same one render.ts uses). */
export function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Grass tufts and flowers on open ground, picked by hash so a plot looks the same every visit. */
export function groundDecor(
  bounds: Bounds,
  solid: ReadonlySet<string>,
): {
  tufts: { x: number; y: number; turn: number }[];
  flowers: { x: number; y: number; warm: boolean }[];
} {
  const tufts: { x: number; y: number; turn: number }[] = [];
  const flowers: { x: number; y: number; warm: boolean }[] = [];
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      if (solid.has(`${x},${y}`)) continue;
      const n = tileHash(x, y);
      const deco = (n >>> 4) % 9;
      const ox = (((n >>> 9) & 15) / 15 - 0.5) * 0.6;
      const oy = (((n >>> 13) & 15) / 15 - 0.5) * 0.6;
      if (deco === 0 || deco === 4)
        tufts.push({ x: x + ox, y: y + oy, turn: ((n >>> 17) & 63) / 10 });
      else if (deco === 2) flowers.push({ x: x + ox, y: y + oy, warm: ((n >>> 20) & 1) === 1 });
    }
  }
  return { tufts, flowers };
}

// ---------- a resident's own home model and art ----------

const MEDIA_ID = /^m_[0-9a-f]{16}$/;

/** A media id (`m_` and 16 hex) or one of our media URLs, as a media URL. Anything else: undefined. */
export function mediaRef(value: unknown): string | undefined {
  if (typeof value === "string" && MEDIA_ID.test(value)) return `/media/${value}`;
  return isMediaUrl(value) ? value : undefined;
}

export interface HomeExtras {
  /** Their own .glb, as one of our media URLs. */
  homeModel?: string;
  /** Their own picture for a painted sign, as one of our media URLs. */
  homeArt?: string;
}

/**
 * Read optional `homeModel` and `homeArt` for a resident from raw JSON (a world snapshot's
 * residents, or a profile's `resident`). Both are optional fields a newer server may send; older
 * servers don't, and anything that isn't exactly our media is ignored.
 */
export function homeExtras(rawResident: unknown): HomeExtras {
  if (!rawResident || typeof rawResident !== "object") return {};
  const r = rawResident as Record<string, unknown>;
  const out: HomeExtras = {};
  const model = mediaRef(r.homeModel);
  const art = mediaRef(r.homeArt);
  if (model) out.homeModel = model;
  if (art) out.homeArt = art;
  return out;
}

/** The raw resident with this id in an unparsed snapshot, if there is one. */
export function rawResident(rawSnapshot: unknown, id: string): unknown {
  const list = (rawSnapshot as { residents?: unknown } | null)?.residents;
  if (!Array.isArray(list)) return undefined;
  return list.find((r) => (r as { id?: unknown } | null)?.id === id);
}

export interface Footprint {
  /** Middle of the footprint, in tile units. */
  x: number;
  y: number;
  width: number;
  depth: number;
  /** Tallest a model may stand, in tiles. */
  height: number;
}

/**
 * Where a resident's own model sits: a square up to 5 tiles wide (smaller on small plots),
 * centered on the hearth (or the middle of the plot) and nudged so it stays on the plot.
 */
export function modelFootprint(layout: PlotLayout, maxHeight = 4): Footprint {
  const side = Math.max(1, Math.min(5, layout.size - 2));
  const anchor = layout.hearth ?? layout.center;
  const { x0, y0, x1, y1 } = layout.bounds;
  // Tile centers are whole numbers, so a tile's edges are at +-0.5.
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    x: clamp(anchor.x, x0 - 0.5 + side / 2, x1 + 0.5 - side / 2),
    y: clamp(anchor.y, y0 - 0.5 + side / 2, y1 + 0.5 - side / 2),
    width: side,
    depth: side,
    height: maxHeight,
  };
}

/** True when a tile's center falls inside the footprint, so its block gives way to the model. */
export function underFootprint(f: Footprint, x: number, y: number): boolean {
  return Math.abs(x - f.x) < f.width / 2 && Math.abs(y - f.y) < f.depth / 2;
}

export interface Box {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * Fit a model's bounding box (three.js axes: y is up) into a box `width` x `height` x `depth`,
 * keeping its proportions: the scale is whichever axis is tightest. Returns the uniform scale and
 * the offset that puts the scaled model's base at y = 0 and its middle at (0, 0) in x and z.
 * A flat axis (a picture plane, say) doesn't limit the scale; a box with no size keeps scale 1.
 */
export function fitModel(
  box: Box,
  fit: { width: number; height: number; depth: number },
): { scale: number; offset: [number, number, number] } {
  const size = [0, 1, 2].map((i) => (box.max[i] ?? 0) - (box.min[i] ?? 0)) as [
    number,
    number,
    number,
  ];
  const limits = [fit.width, fit.height, fit.depth];
  let scale = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const s = size[i] as number;
    if (s > 1e-6) scale = Math.min(scale, (limits[i] as number) / s);
  }
  if (!Number.isFinite(scale)) scale = 1;
  const mid = (i: number) => ((box.min[i] ?? 0) + (box.max[i] ?? 0)) / 2;
  return {
    scale,
    offset: [-mid(0) * scale, -(box.min[1] ?? 0) * scale, -mid(2) * scale],
  };
}

/** What a resident's own model may cost to draw. Bigger ones get a friendly note instead. */
export const MODEL_BUDGET = {
  triangles: 150_000,
  /** Total texture pixels, about four 2048 x 2048 textures. */
  texturePixels: 4 * 2048 * 2048,
  textures: 16,
} as const;

export function overBudget(cost: {
  triangles: number;
  texturePixels: number;
  textures: number;
}): "triangles" | "textures" | undefined {
  if (cost.triangles > MODEL_BUDGET.triangles) return "triangles";
  if (cost.texturePixels > MODEL_BUDGET.texturePixels || cost.textures > MODEL_BUDGET.textures)
    return "textures";
  return undefined;
}
