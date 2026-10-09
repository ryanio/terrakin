/**
 * Pure helpers for the 3D views: which plot to show for a resident, what sits on it, how dark each
 * ground corner is, and how to fit a resident's own model onto their plot. No three.js here, so
 * the math is tested without a GPU.
 */
import { everyoneIn, type WorldSnapshot } from "@terrakin/protocol";
import {
  type BlockKind,
  type Crop,
  type FindKind,
  type GroundKind,
  type Holiday,
  type MadeKind,
  type Pattern,
  type PetCoat,
  type PetKind,
  plotKey,
  type ResidentColor,
  type ResidentShape,
  type Season,
  sortWear,
  type ThemePalette,
  type Tile,
  tileKey,
  WEAR_INFO,
  type WearItem,
  type Weather,
} from "@terrakin/sim";
import type { Feeling } from "@terrakin/ui/feelings";
import { type FigureLook, garmentColor, garmentLook } from "@terrakin/ui/figure";
import { isMediaUrl } from "@terrakin/ui/format";
import { growth } from "@terrakin/ui/item-art";
import { hidesHair } from "@terrakin/ui/looks";
import { dayPhase, nightAmount } from "../time";
import { skyNow } from "../weather";

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
  const resident = everyoneIn(snapshot).find((r) => r.id === residentId);
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
  /** A window in a home someone's in, lit from inside after dark (decision 0098). */
  lit?: true | undefined;
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
  /** What they wear and how it's styled, as the snapshot has it. */
  look: FigureLook;
  /** A feeling to hold while the view is open: sleepy for someone away, asleep at home. */
  feeling?: Feeling | undefined;
  /** Away from the world and asleep at home: drawn faded, never as here (decision 0086). */
  away?: true | undefined;
}

/** One worn thing on a 3D figure: its color, and its pattern when it has one. */
export interface WornPiece {
  item: WearItem;
  color: string;
  pattern?: Pattern;
  /** The colors its pattern is drawn in. */
  palette: ThemePalette;
}

/**
 * What a figure wears, in slot order, each in the color and pattern the 2D figure gives it
 * (`garmentColor`, `garmentLook`). A plain pattern draws nothing, so it's left out. Unknown items
 * from a newer server are skipped.
 */
export function wornPieces(look: FigureLook): WornPiece[] {
  const known = (look.wear ?? []).filter((w) => Object.hasOwn(WEAR_INFO, w));
  return sortWear(known).map((item) => {
    const g = garmentLook(look, item);
    return {
      item,
      color: garmentColor(look, item),
      palette: g.palette,
      ...(g.pattern && g.pattern !== "plain" ? { pattern: g.pattern } : {}),
    };
  });
}

/**
 * Where each hat that covers the crown has its band, in the head's own y (the head is a sphere of
 * 0.17 around its middle). Hair above the band is under the hat (`scene3d/hair.ts`).
 */
export const HAT_BAND: Partial<Record<WearItem, number>> = {
  straw_hat: 0.13,
  beret: 0.11,
  beanie: 0.015,
  top_hat: 0.13,
  witch_hat: 0.13,
};

/** Hair styles that stand up past the head: a puff, spikes, a bun on top. */
const TALL_HAIR: readonly string[] = ["afro", "spiky", "bun"];

/**
 * How high a figure's name tag floats: higher over a top hat, a halo, tall hair, or an umbrella
 * held up (in the rain; otherwise it's rolled up at their side).
 */
export function tagHeight(f: Pick<LayoutFigure, "kind" | "look">, umbrellaUp = false): number {
  const wear = f.look.wear ?? [];
  if (umbrellaUp && wear.includes("umbrella")) return 1.32;
  if (wear.includes("witch_hat")) return 1.26;
  if (wear.includes("top_hat") || wear.includes("muse_halo")) return 1.2;
  if (f.kind === "agent") return 1.2;
  // A pumpkin head or a ghost sheet hides the hair (RFC 0022).
  const tall = f.look.hair !== undefined && TALL_HAIR.includes(f.look.hair) && !hidesHair(wear);
  // Under a hat, the tall part of the hair is tucked away.
  return tall && !wear.some((w) => Object.hasOwn(HAT_BAND, w)) ? 1.15 : 1.08;
}

/** How big a figure is drawn, and its feeling's sign up close, in the figure's own units. */
export const FIGURE_SCALE = 1.3;
export const SIGN_SIZE = 0.34;
/** The share of the view's height a sign never shrinks below, about 30 px on a 390x844 phone. */
const SIGN_SHARE = 0.036;

/**
 * How big to draw a feeling's sign, in the figure's own units, from a camera `distance` away
 * through a lens `fov` degrees tall: its own size up close, and never smaller than a set share of
 * the view further back, so a heart still reads from the world's camera.
 */
export function signSize(distance: number, fov: number): number {
  const viewHeight = 2 * distance * Math.tan((fov * Math.PI) / 360);
  return Math.max(SIGN_SIZE, (SIGN_SHARE * viewHeight) / FIGURE_SCALE);
}

/**
 * Which way, and how far in tiles, to draw someone standing on a hearth's tile, since the
 * stonework fills it: out in front of the fire (south, the camera's usual side) when that tile is
 * free, else beside it to the east or west, else behind. `free(dx, dy)` says whether the tile
 * that far from the hearth is open ground.
 */
export function hearthStand(free: (dx: number, dy: number) => boolean): {
  x: number;
  y: number;
} {
  if (free(0, 1)) return { x: 0, y: 0.6 };
  if (free(1, 0)) return { x: 0.72, y: 0 };
  if (free(-1, 0)) return { x: -0.72, y: 0 };
  if (free(0, -1)) return { x: 0, y: -0.6 };
  return { x: 0, y: 0.6 };
}

/**
 * How much of `hearthStand`'s step to take at (x, y), a figure's place between tiles: all of it on
 * the hearth's tile, none a tile away, and in between while it slides on or off, so walking stays
 * smooth.
 */
export function hearthPull(x: number, y: number, hx: number, hy: number): number {
  return Math.max(0, 1 - Math.max(Math.abs(x - hx), Math.abs(y - hy)));
}

// ---------- residents away, asleep at home (decision 0086) ----------

/** How far apart, in tiles, two residents sleep when more share a hearth than it has open sides. */
export const DOZE_GAP = 0.42;

/**
 * Where someone asleep at a hearth lies: beside it first, east then west, so the hearth itself
 * still shows between them, then in front of it, then behind. Each is clear of the stonework.
 */
const BESIDE = [
  { dx: 1, dy: 0, x: 0.72, y: 0 },
  { dx: -1, dy: 0, x: -0.72, y: 0 },
  { dx: 0, dy: 1, x: 0, y: 0.6 },
  { dx: 0, dy: -1, x: 0, y: -0.6 },
] as const;

/** Someone away, and where they're drawn asleep, in tiles (between tiles, off the stonework). */
export interface Dozer<R> {
  r: R;
  x: number;
  y: number;
}

/**
 * Everyone away who has a hearth, and where to draw them asleep at it, so the town looks lived in
 * while nobody is online: beside the hearth on its open sides (`BESIDE`), one to a side in id order
 * when several share it, and a little along a side once every open side has someone. `free(x, y)`
 * says whether a tile is open ground. `me` is left out: your own figure doesn't doze while you're
 * here to see it. Drawing only: someone asleep is never counted as in the world, never named as
 * nearby, and never in an online count, which all still read `online`. The map and both 3D views
 * place them with this.
 */
export function dozers<R extends { id: string; online: boolean; hearth: Tile | null }>(
  residents: Iterable<R>,
  free: (x: number, y: number) => boolean,
  me?: string,
): Dozer<R>[] {
  const byHearth = new Map<string, { x: number; y: number; who: R[] }>();
  for (const r of residents) {
    const h = r.hearth;
    if (r.online || !h || r.id === me) continue;
    const key = `${h.x},${h.y}`;
    const at = byHearth.get(key);
    if (at) at.who.push(r);
    else byHearth.set(key, { x: h.x, y: h.y, who: [r] });
  }
  const out: Dozer<R>[] = [];
  for (const h of byHearth.values()) {
    const open = BESIDE.filter((s) => free(h.x + s.dx, h.y + s.dy));
    // Boxed in on every side: in front of it all the same.
    const sides = open.length > 0 ? open : [BESIDE[2]];
    h.who.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    h.who.forEach((r, i) => {
      const side = sides[i % sides.length] as (typeof BESIDE)[number];
      // Round two of the sides: a little along it, one way then the other.
      const round = Math.floor(i / sides.length);
      const k = Math.ceil(round / 2) * (round % 2 ? 1 : -1) * DOZE_GAP;
      out.push({ r, x: h.x + side.x + (side.dx ? 0 : k), y: h.y + side.y + (side.dx ? k : 0) });
    });
  }
  return out;
}

/**
 * The resident asleep on a tile: the one whose figure covers it (a figure stands about a tile tall
 * over its feet, so its head reaches the tile above), nearest first, else one at home on that
 * hearth.
 */
export function dozerAt<R extends { hearth: Tile | null }>(
  list: readonly Dozer<R>[],
  x: number,
  y: number,
): Dozer<R> | undefined {
  let best: Dozer<R> | undefined;
  let bestFar = Number.POSITIVE_INFINITY;
  for (const d of list) {
    if (Math.abs(x - d.x) >= 0.78 || y <= d.y - 1.18 || y >= d.y + 0.88) continue;
    const far = Math.abs(x - d.x) + Math.abs(y - (d.y - 0.15));
    if (far < bestFar) {
      best = d;
      bestFar = far;
    }
  }
  return best ?? list.find((d) => d.r.hearth?.x === x && d.r.hearth.y === y);
}

/**
 * The plots whose windows light up after dark (decision 0098): each one holding the hearth of
 * someone at home. Someone away sleeps at their hearth, so they're home; someone in the world is
 * home while they stand on that plot. A plot with no hearth on it never lights.
 */
export function litHomes(
  residents: Iterable<{ online: boolean; x: number; y: number; hearth: Tile | null }>,
  plotSize: number,
): Set<string> {
  const out = new Set<string>();
  for (const r of residents) {
    const h = r.hearth;
    if (!h) continue;
    const px = Math.floor(h.x / plotSize);
    const py = Math.floor(h.y / plotSize);
    const here = Math.floor(r.x / plotSize) === px && Math.floor(r.y / plotSize) === py;
    if (!r.online || here) out.add(plotKey(px, py));
  }
  return out;
}

/** A path or floor on a tile (RFC 0016), and how far into the haze it is, like a block. */
interface LayoutGround {
  x: number;
  y: number;
  ground: GroundKind;
  own: boolean;
  fade: number;
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
  /** Paths and floors on the plot and in the margin. */
  ground: LayoutGround[];
  hearth: { x: number; y: number } | null;
  figures: LayoutFigure[];
  /** What's on display on the plot's pedestals and frames. */
  displays: LayoutDisplay[];
  /** What grows in the plot's planters. */
  crops: LayoutCrop[];
  /** The world's season, for the ground, and the weather when the snapshot was taken. */
  season: Season | undefined;
  weather: Weather;
  /** The holiday the world's day falls in (RFC 0022), for its evenings' light. */
  holiday?: Holiday;
  /** The owner's pet, by the hearth (RFC 0019). Absent when they have none, or no hearth here. */
  pet?: LayoutPet;
  /** The server's clock when the snapshot was taken, for the time of day (decision 0011). */
  time: { nowMs: number; dayLengthMs: number } | undefined;
  /** Is this tile inside the world at all? */
  inWorld(x: number, y: number): boolean;
}

/** A pet in the plot view: where it is, which way it faces, and whether it's curled up asleep. */
interface LayoutPet {
  kind: PetKind;
  coat: PetCoat;
  x: number;
  y: number;
  /** Radians from south toward east, as the world view turns pets. */
  heading: number;
  asleep: boolean;
}

/** Night enough for a pet to curl up by its hearth: past dusk and before dawn. */
function isNight(time: WorldSnapshot["time"]): boolean {
  return time ? nightAmount(dayPhase(time.nowMs, time.dayLengthMs)) > 0.5 : false;
}

/**
 * Where the owner's pet is in the plot view: beside the hearth on the first open tile east, west,
 * south, or north that no figure stands on, curled up and snuggled toward the hearth at night or
 * while its owner is away, and sitting up facing the camera otherwise.
 */
function petSpot(
  hearth: { x: number; y: number },
  free: (x: number, y: number) => boolean,
  asleep: boolean,
): { x: number; y: number; heading: number } | undefined {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const x = hearth.x + dx;
    const y = hearth.y + dy;
    if (!free(x, y)) continue;
    if (!asleep) return { x, y, heading: 0.5 };
    return { x: x - dx * 0.32, y: y - dy * 0.32, heading: Math.atan2(-dx, -dy) };
  }
  return undefined;
}

/**
 * Everything the 3D plot view draws, read from one snapshot. Undefined when the resident is
 * unknown or owns no plot. Residents on the plot are shown if they're online; anyone away whose
 * hearth is here sleeps at it (`dozers`), at any hour; the owner is always home, standing on their
 * own tile when they're on the plot, else beside the hearth. So after dark the plot's windows
 * light up when its owner's hearth is here, and a neighbor's when someone's home there (`litHomes`).
 */
export function plotLayout(
  snapshot: WorldSnapshot,
  residentId: string,
  margin = 4,
): PlotLayout | undefined {
  const everyone = everyoneIn(snapshot);
  const owner = everyone.find((r) => r.id === residentId);
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

  const hearth =
    owner.hearth && inBounds(bounds, owner.hearth.x, owner.hearth.y) ? owner.hearth : null;
  // The owner is always drawn at home here, so their windows light whenever their hearth is here.
  const homes = litHomes(everyone, plotSize);
  if (hearth) homes.add(plotKey(plot.px, plot.py));
  const blocks: LayoutBlock[] = [];
  // The ground floor only, until the plot view draws storeys (RFC 0028).
  for (const b of snapshot.blocks) {
    if (b.storey || !inBounds(outer, b.x, b.y)) continue;
    const d = distanceOutside(bounds, b.x, b.y);
    const home = homes.has(plotKey(Math.floor(b.x / plotSize), Math.floor(b.y / plotSize)));
    blocks.push({
      x: b.x,
      y: b.y,
      block: b.block,
      own: d === 0,
      fade: d / (margin + 1),
      ...(home && b.block === "glass" ? { lit: true as const } : {}),
    });
  }
  blocks.sort((a, b) => a.y - b.y || a.x - b.x);
  const ground: LayoutGround[] = [];
  for (const g of snapshot.ground ?? []) {
    if (g.storey || !inBounds(outer, g.x, g.y)) continue;
    const d = distanceOutside(bounds, g.x, g.y);
    ground.push({ x: g.x, y: g.y, ground: g.ground, own: d === 0, fade: d / (margin + 1) });
  }

  const shown = new Map<string, { good: ShownGood }>([
    ...(snapshot.displays ?? []).map((d) => [tileKey(d.x, d.y), d] as const),
    ...(snapshot.displayedFinds ?? []).map((f) => [tileKey(f.x, f.y), shownFind(f.kind)] as const),
  ]);
  const planted = new Map((snapshot.crops ?? []).map((c) => [tileKey(c.x, c.y), c]));
  const displays: LayoutDisplay[] = [];
  const crops: LayoutCrop[] = [];
  for (const b of blocks) {
    if (!b.own) continue;
    const key = tileKey(b.x, b.y);
    const d = displayOn(b.block, b.x, b.y, shown.get(key));
    if (d) displays.push(d);
    const c = cropIn(b.block, b.x, b.y, planted.get(key), snapshot.day);
    if (c) crops.push(c);
  }

  const solid = new Set(blocks.map((b) => `${b.x},${b.y}`));
  const hearths = new Set(
    everyone.flatMap((r) => (r.hearth ? [tileKey(r.hearth.x, r.hearth.y)] : [])),
  );
  // Everyone away whose hearth is on this plot, asleep at it (decision 0086, RFC 0013).
  const homeHere = everyone.filter((r) => r.hearth && inBounds(bounds, r.hearth.x, r.hearth.y));
  const asleep = new Map(
    dozers(
      homeHere,
      (x, y) =>
        x >= 0 &&
        y >= 0 &&
        x < width &&
        y < height &&
        !solid.has(`${x},${y}`) &&
        !hearths.has(tileKey(x, y)),
    ).map((d) => [d.r.id, d]),
  );
  const figures: LayoutFigure[] = [];
  for (const r of everyone) {
    const isOwner = r.id === owner.id;
    const onPlot = inBounds(bounds, r.x, r.y);
    const dozing = asleep.get(r.id);
    if (!isOwner && !dozing && !(r.online && onPlot)) continue;
    const spot = dozing ?? (onPlot ? { x: r.x, y: r.y } : homeSpot(bounds, hearth, solid));
    figures.push({
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      shape: r.shape,
      x: spot.x,
      y: spot.y,
      owner: isOwner,
      look: {
        color: r.color,
        shape: r.shape,
        theme: r.theme,
        pattern: r.pattern,
        patternMedia: r.patternMedia,
        wear: r.wear,
        wearStyle: r.wearStyle,
        hair: r.hair,
        hairColor: r.hairColor,
      },
      ...(dozing ? { feeling: "sleepy" as const, away: true as const } : {}),
    });
  }
  const { season, weather } = skyNow(snapshot.time.nowMs, snapshot.day);

  // The owner's pet, beside the hearth and clear of everyone drawn there, sleepers too: they lie
  // between tiles, so each takes the tile they're nearest.
  const taken = new Set(figures.map((f) => `${Math.round(f.x)},${Math.round(f.y)}`));
  const night = isNight(snapshot.time);
  const pet =
    owner.pet && hearth
      ? petSpot(
          hearth,
          (x, y) => inBounds(bounds, x, y) && !solid.has(`${x},${y}`) && !taken.has(`${x},${y}`),
          night || !owner.online,
        )
      : undefined;

  return {
    ownerId: owner.id,
    ownerName: owner.name,
    plot,
    bounds,
    size: plotSize,
    center: { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 },
    margin,
    blocks,
    ground,
    hearth,
    figures,
    displays,
    crops,
    season,
    weather,
    ...(snapshot.holiday ? { holiday: snapshot.holiday } : {}),
    ...(owner.pet && pet
      ? {
          pet: {
            kind: owner.pet.kind,
            coat: owner.pet.coat,
            ...pet,
            asleep: night || !owner.online,
          },
        }
      : {}),
    time: snapshot.time,
    inWorld: (x, y) => x >= 0 && y >= 0 && x < width && y < height,
  };
}

/** A made thing on display, or a find (RFC 0021), as the 3D views draw it. */
export interface ShownGood {
  id: string;
  kind: MadeKind | FindKind;
  media?: string | undefined;
  model?: true | undefined;
}

/** A find on display, drawn like a made thing with no picture of its own: `find:<kind>` names it. */
export const shownFind = (kind: FindKind): { good: ShownGood } => ({
  good: { id: `find:${kind}`, kind },
});

/** Something on display on a pedestal or in a frame. */
export interface LayoutDisplay {
  x: number;
  y: number;
  on: "pedestal" | "frame";
  good: ShownGood;
}

/** A crop in a planter, and how far along it is (0 to 1, ready at 1). */
export interface LayoutCrop {
  x: number;
  y: number;
  crop: Crop;
  done: number;
}

/** What a pedestal or frame shows, if it shows anything. Anything else shows nothing. */
export function displayOn(
  block: BlockKind | undefined,
  x: number,
  y: number,
  shown: { good: ShownGood } | undefined,
): LayoutDisplay | undefined {
  if (!shown || (block !== "pedestal" && block !== "frame")) return undefined;
  const { id, kind, media, model } = shown.good;
  return { x, y, on: block, good: { id, kind, media, model } };
}

/** What grows in a planter, drawn from the world's day the way the map draws it. */
export function cropIn(
  block: BlockKind | undefined,
  x: number,
  y: number,
  planting: { crop: Crop; plantedDay: number; readyDay: number } | undefined,
  day: number | undefined,
): LayoutCrop | undefined {
  if (!planting || block !== "planter") return undefined;
  return { x, y, crop: planting.crop, done: growth(planting.plantedDay, planting.readyDay, day) };
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

/** A fallen leaf on the ground: where, its turn, and which of the palette's `LEAF_TONES`. */
export interface GroundLeaf {
  x: number;
  y: number;
  turn: number;
  tone: 0 | 1 | 2;
}

/**
 * Grass tufts and flowers on open ground, picked by hash so a plot looks the same every visit. In
 * autumn the flowers are fallen leaves and more leaves lie about; in winter only tufts show.
 */
export function groundDecor(
  bounds: Bounds,
  solid: ReadonlySet<string>,
  season?: Season,
): {
  tufts: { x: number; y: number; turn: number }[];
  flowers: { x: number; y: number; warm: boolean }[];
  leaves: GroundLeaf[];
} {
  const tufts: { x: number; y: number; turn: number }[] = [];
  const flowers: { x: number; y: number; warm: boolean }[] = [];
  const leaves: GroundLeaf[] = [];
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      if (solid.has(`${x},${y}`)) continue;
      const n = tileHash(x, y);
      const deco = (n >>> 4) % 9;
      const ox = (((n >>> 9) & 15) / 15 - 0.5) * 0.6;
      const oy = (((n >>> 13) & 15) / 15 - 0.5) * 0.6;
      if (deco === 0 || deco === 4)
        tufts.push({ x: x + ox, y: y + oy, turn: ((n >>> 17) & 63) / 10 });
      else if (season === "autumn" && (deco === 2 || deco === 6 || deco === 7))
        leaves.push({
          x: x + ox,
          y: y + oy,
          turn: ((n >>> 17) & 63) / 10,
          tone: ((n >>> 20) % 3) as 0 | 1 | 2,
        });
      else if (deco === 2 && season !== "winter")
        flowers.push({ x: x + ox, y: y + oy, warm: ((n >>> 20) & 1) === 1 });
    }
  }
  return { tufts, flowers, leaves };
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
  const raw = rawSnapshot as { residents?: unknown; townsfolkResidents?: unknown } | null;
  for (const list of [raw?.residents, raw?.townsfolkResidents]) {
    if (!Array.isArray(list)) continue;
    const found = list.find((r) => (r as { id?: unknown } | null)?.id === id);
    if (found) return found;
  }
  return undefined;
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
const MODEL_BUDGET = {
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
