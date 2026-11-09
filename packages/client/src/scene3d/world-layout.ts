/**
 * Pure helpers for the world in 3D (decision 0060): which plots are loaded around you, who is drawn,
 * which tile a tap lands on, and how things glide. No three.js here, so it's tested without a GPU.
 * Scene coordinates are tile coordinates: tile (x, y) stands at scene (x, 0, y), north is -z.
 */
import {
  type BlockKind,
  type Crop,
  chebyshev,
  type Direction,
  type DrawnGround,
  edgeKey,
  type FindKind,
  FLOORS,
  type Grade,
  type GroundKind,
  groundTile,
  insetOf,
  type PickupKind,
  parseEdgeKey,
  plotKey,
  type Resident,
  type RoofShape,
  type Scenery,
  type Season,
  STEP,
  type Turn,
  tileKey,
  type WorldConfig,
} from "@terrakin/sim";
import { type PileSource, type PresentPile, presentPiles } from "../presents";
import { featureOn, type Wild, yardGrowth } from "../wild-yard";
import {
  type Bounds,
  cropIn,
  type Dozer,
  displayOn,
  type GroundLeaf,
  type LayoutCrop,
  type LayoutDisplay,
  type LayoutEdge,
  plotBounds,
  potsOn,
  type RoomShown,
  roomPart,
  roomThingsOn,
  type ShownGood,
  shownFind,
} from "./layout";

/** How far around you the world is drawn, in tiles (Chebyshev, like reach). Fog hides the edge. */
export const VIEW_RADIUS = 12;
/** A loaded plot stays until you're this many tiles past the view radius, so edges don't flicker. */
const KEEP_SLACK = 4;
/**
 * At most this many residents are drawn, nearest first. You're always one of them, then everyone
 * online, then anyone away asleep at home fills what's left.
 */
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

/** What one frame does to the plots drawn around you. */
export interface ChunkPlan {
  /** The plots (by `plotKey`) that stay loaded; the rest are dropped. */
  keep: ReadonlySet<string>;
  /** The plots to build, or build again, this frame, nearest first. */
  build: Tile[];
  /** Whether more plots wait for a later frame. */
  pending: boolean;
}

/**
 * Which plots to keep and which to build around `focus`, nearest first by their middles and at
 * most `BUILDS_PER_FRAME`. A plot already built is built again only when something `changed` and
 * `current(p)`, its drawing's signature check, says it no longer matches.
 */
export function chunkPlan(o: {
  focus: Tile;
  config: WorldConfig;
  built: (key: string) => boolean;
  changed: boolean;
  current: (p: Tile) => boolean;
}): ChunkPlan {
  const { focus, config } = o;
  const keep = new Set(
    plotsAround(focus, VIEW_RADIUS + KEEP_SLACK, config).map((p) => plotKey(p.x, p.y)),
  );
  const S = config.plotSize;
  const middle = (p: Tile) => ({ x: p.x * S + S / 2, y: p.y * S + S / 2 });
  const wanted = plotsAround(focus, VIEW_RADIUS, config).sort(
    (a, b) => chebyshev(focus, middle(a)) - chebyshev(focus, middle(b)),
  );
  const build: Tile[] = [];
  for (const p of wanted) {
    const have = o.built(plotKey(p.x, p.y));
    if (have && (!o.changed || o.current(p))) continue;
    if (build.length >= BUILDS_PER_FRAME) return { keep, build, pending: true };
    build.push(p);
  }
  return { keep, build, pending: false };
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
    const d = chebyshev(r, focus);
    if (d <= radius) near.push({ r, d });
  }
  near.sort((a, b) => a.d - b.d || (a.r.id < b.r.id ? -1 : 1));
  const out = near.map((n) => n.r);
  if (mine) out.unshift(mine);
  return out.slice(0, max);
}

/**
 * Who of those away and asleep at home to draw (decision 0086): the nearest within `radius` of
 * `focus`, at most `room` of them, so they only fill places the online leave free.
 */
export function dozersAround<R extends { id: string }>(
  asleep: readonly Dozer<R>[],
  focus: Tile,
  room: number,
  radius = VIEW_RADIUS,
): Dozer<R>[] {
  if (room <= 0) return [];
  return asleep
    .map((d) => ({ d, far: chebyshev(d, focus) }))
    .filter((n) => n.far <= radius)
    .sort((a, b) => a.far - b.far || (a.d.r.id < b.d.r.id ? -1 : 1))
    .slice(0, room)
    .map((n) => n.d);
}

/** What one plot of the world holds, read from the mirror, with a signature that changes with it. */
export interface PlotChunk {
  px: number;
  py: number;
  bounds: Bounds;
  owner: string | undefined;
  /** Blocks on every floor shown (RFC 0028), `floor` on those above the ground floor. */
  blocks: { x: number; y: number; block: BlockKind; floor?: number; lit?: true }[];
  /** Paths and flooring (RFC 0016), under whatever stands on them, and flooring upstairs. */
  ground: { x: number; y: number; ground: DrawnGround; floor?: number }[];
  /** The highest floor with anything on it, shown or cut away. */
  highest: number;
  /** Its roof (RFC 0041), drawn over the walls, or none while the plot is the one cut away. */
  roof?: RoofShape;
  /** Walls between tiles on every floor shown (RFC 0050), each on a tile's `n` or `w` line. */
  edges: LayoutEdge[];
  hearths: Tile[];
  /** What's on display on its pedestals and frames, and what grows in its planters. */
  displays: LayoutDisplay[];
  crops: LayoutCrop[];
  /** Grass tufts, flowers, and autumn leaves on open ground, from the palette the map draws with. */
  tufts: { x: number; y: number; turn: number }[];
  flowers: { x: number; y: number; warm: boolean }[];
  leaves: GroundLeaf[];
  /**
   * The wild yard past the lot (RFC 0052, `wild-yard.ts`): bushes and trees where they grow, and
   * the slot's feature as more of them (an old tree is a big tree) or as stones (a boulder, an old
   * wall), with `size` in tiles. Drawing only.
   */
  yard: YardThings;
  /** Today's fallen branches, loose stones, and finds still lying there, from the sim's spawn. */
  /** `notYours`: on a plot the viewer may not gather on, so it's drawn faded. */
  pickups: { x: number; y: number; kind: PickupKind; notYours?: true }[];
  /** A home someone's in, so its windows light up after dark (`litHomes`, decision 0098). */
  lit: boolean;
  /** Presents waiting under a tree or by a hearth (RFC 0034). */
  presents: ({ key: string } & PresentPile)[];
  /** Equal for two reads exactly when what's drawn is the same. */
  signature: string;
}

/** What a chunk's wild yard draws beyond tufts and flowers (RFC 0052). */
export interface YardThings {
  bushes: { x: number; y: number; size: number }[];
  trees: { x: number; y: number; size: number; tone: 0 | 1 | 2 }[];
  /** A stone's middle, its half-size across (`sx`) and down (`sz`) in tiles, and its height. */
  stones: { x: number; y: number; sx: number; sz: number; high: number }[];
}

/** The parts of the mirror a chunk reads. */
export interface ChunkSource {
  config: WorldConfig;
  /**
   * Whether a tile draws as wild ground (`Mirror.wildAt`, RFC 0052): a slot's yard past its lot or
   * a street's verge. Absent reads as none, as in a world before its regrid.
   */
  wildAt?(x: number, y: number): Wild | null;
  /** A slot's lot side (`Mirror.lotOf`), in a chunk's signature so a lot that grew redraws. */
  lotSide?(px: number, py: number): number;
  commons: { px: number; py: number };
  blocks: ReadonlyMap<string, BlockKind>;
  /** Paths and flooring by tile key. Absent reads as none. */
  paving?: ReadonlyMap<string, GroundKind>;
  /**
   * The ground floor's paths as they're drawn, the town's streets and ways under what's laid
   * (`Mirror.drawnPaving`, RFC 0046). Read in place of `paving` when present.
   */
  drawnPaving?: ReadonlyMap<string, DrawnGround>;
  /**
   * Each floor above the ground floor (RFC 0028), by its number: its blocks and flooring by tile
   * key (`Mirror.upstairs`). Absent reads as none.
   */
  upstairs?: ReadonlyMap<
    number,
    { blocks: ReadonlyMap<string, BlockKind>; paving: ReadonlyMap<string, GroundKind> }
  >;
  plots: ReadonlyMap<string, string>;
  displays?: ReadonlyMap<string, { good: ShownGood }>;
  /** Pots set down (RFC 0047), by the sim's `potKey`. Absent reads as none. */
  pots?: ReadonlyMap<string, { good: ShownGood }>;
  /** Small things on surfaces (RFC 0050), by the sim's `topKey`. Absent reads as none. */
  tops?: ReadonlyMap<string, RoomShown>;
  /** Things hung on walls (RFC 0050), by the sim's `faceKey`. Absent reads as none. */
  hung?: ReadonlyMap<string, RoomShown>;
  /** Finds on display (RFC 0021), by tile key. */
  shownFinds?: ReadonlyMap<string, { kind: FindKind }>;
  crops?: ReadonlyMap<string, { crop: Crop; plantedDay: number; readyDay: number }>;
  /** Kilns firing a pot (RFC 0047), by tile key: each glows after dark. Absent reads as none. */
  kilns?: ReadonlyMap<string, unknown>;
  day?: number | undefined;
  /** What lies on a tile to pick up today (`Mirror.pickupAt`). */
  pickupAt?(x: number, y: number): PickupKind | null;
  /** Whether a resident may pick up what lies on a tile, by the sim's rule (`Mirror.mayGatherAt`). */
  mayGatherAt?(x: number, y: number, residentId: string): boolean;
  /** Who lives where, for where their presents wait (RFC 0034). */
  residents?: PileSource["residents"];
  /** How many presents wait for each resident (RFC 0034). Absent reads as none. */
  presents?: ReadonlyMap<string, number>;
  /** The roof over a plot (RFC 0041), drawn over its walls (`Mirror.roofAt`). */
  roofAt?(px: number, py: number): RoofShape | undefined;
  /** Whether a tile is open water between lands (RFC 0038). Absent reads as none, as it is today. */
  isSea?(x: number, y: number): boolean;
  /** Walls between tiles on a floor (RFC 0050), by the sim's `edgeKey`. Absent reads as none. */
  edgesOn?(floor: number): ReadonlyMap<string, BlockKind>;
  /** A wall's grade (RFC 0051) by its tile or edge key (`Mirror.gradeAt`). Absent reads as plain. */
  gradeAt?(key: string, floor?: number): Grade;
  /** Which way a piece faces by its tile key (`Mirror.turnAt`). Absent reads as south. */
  turnAt?(key: string, floor?: number): Turn;
}

/** A turned piece's part of a chunk's signature, so turning one redraws it: empty for south. */
const turnPart = (turn: Turn) => (turn ? `:t${turn}` : "");

/** A graded wall's part of a chunk's signature, so a regraded wall redraws: empty for plain. */
const gradePart = (grade: Grade | undefined) => (grade && grade !== "plain" ? `:${grade}` : "");

/** The piles of presents (RFC 0034) on one plot, by tile key, with the words for its signature. */
function pilesOn(source: ChunkSource, bounds: Bounds): ({ key: string } & PresentPile)[] {
  if (!source.presents?.size || !source.residents) return [];
  const here = presentPiles(
    {
      config: source.config,
      residents: source.residents,
      blocks: source.blocks,
      presents: source.presents,
    },
    bounds,
  );
  return [...here].map(([key, pile]) => ({ key, ...pile }));
}

/**
 * What stands on one tile, and the words for it in a chunk's signature. A window's words say
 * whether its home is `lit`, so a plot is built again when someone comes home only if it has one.
 */
function tileThings(
  source: ChunkSource,
  x: number,
  y: number,
  hearths: ReadonlySet<string>,
  lit: boolean,
  viewer?: string,
) {
  const key = tileKey(x, y);
  const block = source.blocks.get(key);
  const ground = (source.drawnPaving ?? source.paving)?.get(key);
  const hearth = hearths.has(key);
  const find = source.shownFinds?.get(key);
  const display = displayOn(
    block,
    x,
    y,
    source.displays?.get(key) ?? (find ? shownFind(find.kind) : undefined),
  );
  const crop = cropIn(block, x, y, source.crops?.get(key), source.day);
  const parts: string[] = [];
  // A kiln firing a pot (RFC 0047) glows, so its plot is built again when it's loaded or emptied.
  const firing = block === "kiln" && source.kilns?.has(key) === true;
  const shining = (lit && block === "glass") || firing;
  const grade = block ? (source.gradeAt?.(key) ?? "plain") : "plain";
  const turn = block ? (source.turnAt?.(key) ?? 0) : 0;
  if (block)
    parts.push(`${key}:${block}${gradePart(grade)}${turnPart(turn)}${shining ? ":lit" : ""}`);
  if (ground) parts.push(`${key}:on:${ground}`);
  if (hearth) parts.push(`${key}:hearth`);
  // The picture too: staff can remove a piece's picture while it stays up (picture_removed).
  if (display) parts.push(`${key}:shows:${display.good.id}:${display.good.media ?? ""}`);
  if (crop) parts.push(`${key}:${crop.crop}:${crop.done.toFixed(2)}`);
  // Same rule as the map and the sim: a pickup lies anywhere not built on, hearths too.
  const pickup = source.pickupAt?.(x, y) ?? null;
  const notYours =
    pickup !== null && viewer !== undefined && source.mayGatherAt?.(x, y, viewer) === false;
  if (pickup) parts.push(`${key}:${pickup}${notYours ? ":not-yours" : ""}`);
  return { block, grade, turn, ground, hearth, display, crop, pickup, notYours, parts, firing };
}

/**
 * Read one plot from the mirror. `hearths` holds every resident's hearth tile key, `season`
 * dresses the ground (today's look without one), `lit` says someone's home there, and `cut` is
 * the floor it's cut away at (RFC 0028): on the plot you stand on, yours, so nothing above you
 * is drawn; on every other plot, absent, so it shows whole. `viewer` is who's looking: what lies
 * where they may not pick it up is marked `notYours`.
 */
export function readChunk(
  source: ChunkSource,
  px: number,
  py: number,
  hearths: ReadonlySet<string>,
  season?: Season,
  lit = false,
  cut?: number,
  viewer?: string,
): PlotChunk {
  const bounds = plotBounds(source.config.plotSize, px, py);
  const owner = source.plots.get(`${px},${py}`);
  const inCommons = px === source.commons.px && py === source.commons.py;
  const blocks: PlotChunk["blocks"] = [];
  const ground: PlotChunk["ground"] = [];
  const homes: Tile[] = [];
  const displays: LayoutDisplay[] = [];
  const crops: LayoutCrop[] = [];
  const tufts: PlotChunk["tufts"] = [];
  const flowers: PlotChunk["flowers"] = [];
  const leaves: GroundLeaf[] = [];
  const pickups: PlotChunk["pickups"] = [];
  const parts: string[] = [owner ?? "", season ?? "", lotPart(source, px, py)];
  const yard: YardThings = { bushes: [], trees: [], stones: [] };
  const featured = yardFeature(source, px, py, yard, flowers, tufts, season);
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const at = tileThings(source, x, y, hearths, lit, viewer);
      parts.push(...at.parts);
      if (at.block)
        blocks.push({
          x,
          y,
          block: at.block,
          ...(at.firing ? { lit: true as const } : {}),
          ...(at.grade !== "plain" ? { grade: at.grade } : {}),
          ...(at.turn ? { turn: at.turn } : {}),
        });
      if (at.ground) ground.push({ x, y, ground: at.ground });
      if (at.hearth) homes.push({ x, y });
      if (at.display) displays.push(at.display);
      if (at.crop) crops.push(at.crop);
      if (at.pickup) {
        pickups.push({
          x,
          y,
          kind: at.pickup,
          ...(at.notYours ? { notYours: true as const } : {}),
        });
      }
      // Nothing grows or falls on open water (RFC 0038), as on the map.
      if (at.block || at.hearth || at.ground || source.isSea?.(x, y)) continue;
      const tile = groundTile(source.config, x, y, inCommons, season);
      const wild = source.wildAt?.(x, y) ?? null;
      if (wild && !featured.has(tileKey(x, y))) {
        growYard(yardGrowth(x, y, tile.biome, season, wild), x, y, yard, tufts, flowers);
      }
      // On wild ground the yard's own growth takes the place of the palette's, all but leaves.
      const scenery: Scenery | null = wild && tile.scenery?.kind !== "leaf" ? null : tile.scenery;
      if (scenery?.kind === "tuft")
        tufts.push({ x: x + scenery.fx - 0.5, y: y + 0.2, turn: ((x * 7 + y * 13) % 63) / 10 });
      else if (scenery?.kind === "flower")
        flowers.push({
          x: x + scenery.fx - 0.5,
          y: y + scenery.fy - 0.5,
          warm: scenery.tone === 1,
        });
      else if (scenery?.kind === "leaf")
        leaves.push({
          x: x + scenery.fx - 0.5,
          y: y + scenery.fy - 0.5,
          turn: scenery.turn,
          tone: scenery.tone,
        });
    }
  }
  const up = upstairsOf(source, bounds, lit, cut);
  blocks.push(...up.blocks);
  ground.push(...up.ground);
  parts.push(...up.parts);
  // Pots set down (RFC 0047), on whichever floors are shown, each as itself.
  for (const pot of potsShown(source, bounds, up.blocks)) {
    displays.push(pot);
    parts.push(potPart(pot));
  }
  // Things on surfaces and walls (RFC 0050), on the same floors.
  for (const thing of roomShown(source, bounds, up.blocks)) {
    displays.push(thing);
    parts.push(roomPart(thing));
  }
  const presents = pilesOn(source, bounds);
  for (const p of presents) parts.push(`gift:${p.key}:${p.count}:${p.tree}`);
  // The roof lifts away on the plot you stand on, which is the one with a cut (RFC 0041).
  const roof = cut === undefined ? source.roofAt?.(px, py) : undefined;
  if (roof) parts.push(roofPart(roof));
  const edges = edgesShown(source, bounds, cut);
  for (const e of edges) {
    parts.push(`edge:${e.x},${e.y},${e.side},${e.floor ?? 0}:${e.block}${gradePart(e.grade)}`);
  }
  return {
    px,
    py,
    bounds,
    owner,
    // A pot set down (RFC 0047) is drawn as itself, among the displays, not as a block.
    blocks: blocks.filter((b) => b.block !== "pot"),
    ground,
    highest: up.highest,
    ...(roof ? { roof } : {}),
    edges,
    hearths: homes,
    displays,
    crops,
    tufts,
    flowers,
    leaves,
    yard,
    pickups,
    lit,
    presents,
    signature: parts.join("|"),
  };
}

/**
 * The wild yard of slot (px, py) on its own (RFC 0052), for a view that draws one plot rather than
 * the world's chunks: every tile `wildAt` calls wild, with the slot's feature.
 */
export function yardIn(
  source: { config: WorldConfig; wildAt(x: number, y: number): Wild | null },
  px: number,
  py: number,
  season?: Season,
): { yard: YardThings; tufts: PlotChunk["tufts"]; flowers: PlotChunk["flowers"] } {
  const yard: YardThings = { bushes: [], trees: [], stones: [] };
  const tufts: PlotChunk["tufts"] = [];
  const flowers: PlotChunk["flowers"] = [];
  const featured = yardFeature(source, px, py, yard, flowers, tufts, season);
  const bounds = plotBounds(source.config.plotSize, px, py);
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const wild = source.wildAt(x, y);
      if (!wild || featured.has(tileKey(x, y))) continue;
      const biome = groundTile(source.config, x, y, false, season).biome;
      growYard(yardGrowth(x, y, biome, season, wild), x, y, yard, tufts, flowers);
    }
  }
  return { yard, tufts, flowers };
}

/** A slot's lot in a chunk's signature: what's wild changes when it grows. */
const lotPart = (source: ChunkSource, px: number, py: number) =>
  source.lotSide ? `lot:${source.lotSide(px, py)}` : "";

/** One wild tile's growth, in scene tiles, onto the chunk's lists. */
function growYard(
  g: ReturnType<typeof yardGrowth>,
  x: number,
  y: number,
  yard: YardThings,
  tufts: PlotChunk["tufts"],
  flowers: PlotChunk["flowers"],
) {
  if (!g) return;
  const at = { x: x + g.fx - 0.5, y: y + g.fy - 0.5 };
  if (g.kind === "grass") {
    tufts.push({ ...at, turn: ((x * 7 + y * 13) % 63) / 10 });
    tufts.push({ x: at.x + 0.22, y: at.y + 0.12, turn: ((x * 11 + y * 5) % 63) / 10 });
  } else if (g.kind === "flowers") {
    for (let i = 0; i < g.count; i++) {
      const a = (i / g.count) * Math.PI * 2 + g.tone;
      const d = i === 0 ? 0 : 0.13;
      flowers.push({ x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d, warm: g.tone === 1 });
    }
  } else if (g.kind === "bush") yard.bushes.push({ ...at, size: g.size });
  else yard.trees.push({ ...at, size: g.size, tone: g.tone });
}

/**
 * Slot (px, py)'s feature (RFC 0052) onto the chunk's lists, when it draws whole on wild ground:
 * an old tree as a big tree, a boulder and an old wall as stones, a flowering bank as flowers and
 * tufts. Returns the tiles it covers, which grow nothing else.
 */
function yardFeature(
  source: Pick<ChunkSource, "config" | "wildAt">,
  px: number,
  py: number,
  yard: YardThings,
  flowers: PlotChunk["flowers"],
  tufts: PlotChunk["tufts"],
  season: Season | undefined,
): Set<string> {
  const covered = new Set<string>();
  if (!source.wildAt) return covered;
  const S = source.config.plotSize;
  const f = featureOn(
    px,
    py,
    S,
    insetOf(source.config),
    (x, y) => source.wildAt?.(x, y) === "yard",
  );
  if (!f) return covered;
  for (const t of f.world) covered.add(tileKey(t.x, t.y));
  const xs = f.world.map((t) => t.x);
  const ys = f.world.map((t) => t.y);
  const mid = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  if (f.kind === "old_tree") {
    yard.trees.push({ ...mid, size: 0.95, tone: 2 });
  } else if (f.kind === "boulder") {
    const wide = Math.max(...xs) - Math.min(...xs) + 1;
    const deep = Math.max(...ys) - Math.min(...ys) + 1;
    yard.stones.push({ ...mid, sx: wide * 0.42, sz: deep * 0.4, high: 0.55 });
  } else if (f.kind === "stone_wall") {
    const across = f.side === "n" || f.side === "s";
    for (const t of f.world) {
      for (const along of [-0.3, 0, 0.3]) {
        yard.stones.push({
          x: t.x + (across ? along : 0),
          y: t.y + (across ? 0 : along),
          sx: across ? 0.17 : 0.13,
          sz: across ? 0.13 : 0.17,
          high: 0.28,
        });
      }
    }
  } else {
    for (const [i, t] of f.world.entries()) {
      tufts.push({ x: t.x - 0.2, y: t.y + 0.25, turn: i });
      if (season === "winter") continue;
      for (const [dx, dy, warm] of [
        [0, -0.05, false],
        [-0.25, -0.3, i % 2 === 1],
        [0.25, 0.2, true],
        [0.2, -0.25, false],
        [-0.2, 0.15, true],
      ] as const) {
        flowers.push({ x: t.x + dx, y: t.y + dy, warm });
      }
    }
  }
  return covered;
}

/**
 * What stands and lies upstairs on a plot (RFC 0028), floor by floor from the bottom, up to
 * `cut` (the plot you stand on, cut away at your floor) or every floor (any other plot), with
 * the words for it in a chunk's signature. `highest` is the top floor with anything on it, cut
 * away or not, and a cut that hides something says so in the words, since its walls get caps.
 */
function upstairsOf(
  source: ChunkSource,
  bounds: Bounds,
  lit: boolean,
  cut: number | undefined,
): {
  blocks: { x: number; y: number; block: BlockKind; floor: number }[];
  ground: { x: number; y: number; ground: GroundKind; floor: number }[];
  highest: number;
  parts: string[];
} {
  const blocks: { x: number; y: number; block: BlockKind; floor: number }[] = [];
  const ground: { x: number; y: number; ground: GroundKind; floor: number }[] = [];
  const parts: string[] = [];
  let highest = 0;
  const floors = [...(source.upstairs?.keys() ?? [])].sort((a, b) => a - b);
  for (const floor of floors) {
    const layer = source.upstairs?.get(floor);
    if (!layer || (layer.blocks.size === 0 && layer.paving.size === 0)) continue;
    const shown = cut === undefined || floor <= cut;
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        const key = tileKey(x, y);
        const block = layer.blocks.get(key);
        const laid = layer.paving.get(key);
        if (!block && !laid) continue;
        highest = Math.max(highest, floor);
        if (!shown) continue;
        if (block) {
          const grade = source.gradeAt?.(key, floor) ?? "plain";
          const turn = source.turnAt?.(key, floor) ?? 0;
          blocks.push({
            x,
            y,
            block,
            floor,
            ...(grade !== "plain" ? { grade } : {}),
            ...(turn ? { turn } : {}),
          });
          parts.push(
            `${key}@${floor}:${block}${gradePart(grade)}${turnPart(turn)}${lit && block === "glass" ? ":lit" : ""}`,
          );
        }
        if (laid) {
          ground.push({ x, y, ground: laid, floor });
          parts.push(`${key}@${floor}:on:${laid}`);
        }
      }
    }
  }
  if (cut !== undefined && highest > cut) parts.push(`cut:${cut}`);
  return { blocks, ground, highest, parts };
}

/**
 * A roof in a chunk's signature. `chunkSignature` and `readChunk` both build it, so a plot with a
 * roof can match itself: a part one of them pushes and the other doesn't is a chunk that never
 * matches and so is torn down and rebuilt on every input anyone sends. The ridge is in it because
 * a `roof_top_set` changes nothing else on the plot, so without it a new vane would never appear.
 */
function roofPart(roof: RoofShape): string {
  const top = roof.top ? `${roof.top.kind}@${roof.top.x},${roof.top.y}` : "";
  return `roof:${roof.style}:${roof.material}${gradePart(roof.grade)}:${roof.floor}:${top}`;
}

/** Just the signature of a plot, cheap enough to check on every change to the mirror. */
export function chunkSignature(
  source: ChunkSource,
  px: number,
  py: number,
  hearths: ReadonlySet<string>,
  season?: Season,
  lit = false,
  cut?: number,
  viewer?: string,
): string {
  const bounds = plotBounds(source.config.plotSize, px, py);
  const parts: string[] = [
    source.plots.get(`${px},${py}`) ?? "",
    season ?? "",
    lotPart(source, px, py),
  ];
  for (let y = bounds.y0; y <= bounds.y1; y++)
    for (let x = bounds.x0; x <= bounds.x1; x++)
      parts.push(...tileThings(source, x, y, hearths, lit, viewer).parts);
  const up = upstairsOf(source, bounds, lit, cut);
  parts.push(...up.parts);
  for (const pot of potsShown(source, bounds, up.blocks)) parts.push(potPart(pot));
  for (const thing of roomShown(source, bounds, up.blocks)) parts.push(roomPart(thing));
  for (const p of pilesOn(source, bounds)) parts.push(`gift:${p.key}:${p.count}:${p.tree}`);
  const roof = cut === undefined ? source.roofAt?.(px, py) : undefined;
  if (roof) parts.push(roofPart(roof));
  for (const e of edgesShown(source, bounds, cut)) {
    parts.push(`edge:${e.x},${e.y},${e.side},${e.floor ?? 0}:${e.block}${gradePart(e.grade)}`);
  }
  return parts.join("|");
}

/**
 * The walls between tiles a plot draws (RFC 0050): each line owned by one of its tiles, on the
 * ground floor and every floor shown, so the floors above the cut on the plot you stand on stay
 * away as their blocks do.
 */
function edgesShown(source: ChunkSource, bounds: Bounds, cut: number | undefined): LayoutEdge[] {
  if (!source.edgesOn) return [];
  const out: LayoutEdge[] = [];
  for (let floor = 0; floor <= FLOORS.max; floor++) {
    if (cut !== undefined && floor > cut) break;
    for (const [key, block] of source.edgesOn(floor)) {
      const { x, y, side } = parseEdgeKey(key);
      if (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) continue;
      const grade = source.gradeAt?.(key, floor) ?? "plain";
      out.push({
        x,
        y,
        side,
        block,
        ...(floor ? { floor } : {}),
        ...(grade !== "plain" ? { grade } : {}),
      });
    }
  }
  return out;
}

/** The pots set down on a plot's ground floor and the floors shown above it (RFC 0047). */
function potsShown(
  source: ChunkSource,
  bounds: Bounds,
  upstairs: readonly { x: number; y: number; block: BlockKind; floor?: number }[],
): LayoutDisplay[] {
  if (!source.pots || source.pots.size === 0) return [];
  const below: { x: number; y: number; block: BlockKind }[] = [];
  for (let y = bounds.y0; y <= bounds.y1; y++)
    for (let x = bounds.x0; x <= bounds.x1; x++)
      if (source.blocks.get(tileKey(x, y)) === "pot") below.push({ x, y, block: "pot" });
  return potsOn([...below, ...upstairs], source.pots);
}

/** The things on surfaces and walls (RFC 0050) on a plot's ground floor and the floors shown. */
function roomShown(
  source: ChunkSource,
  bounds: Bounds,
  upstairs: readonly { x: number; y: number; block: BlockKind; floor?: number }[],
): LayoutDisplay[] {
  if (!source.tops?.size && !source.hung?.size) return [];
  const below: { x: number; y: number; block: BlockKind }[] = [];
  for (let y = bounds.y0; y <= bounds.y1; y++)
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const block = source.blocks.get(tileKey(x, y));
      if (block) below.push({ x, y, block });
    }
  const floors = new Set([0, ...upstairs.flatMap((b) => (b.floor ? [b.floor] : []))]);
  return roomThingsOn(
    [...below, ...upstairs],
    source.tops,
    source.hung,
    (x, y) => x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1,
    floors,
    (x, y, side, floor) => source.edgesOn?.(floor).get(edgeKey(x, y, side)) !== undefined,
  );
}

/** A pot's words in a chunk's signature: where, which, and a vase's flower. */
const potPart = (pot: LayoutDisplay) =>
  `pot:${pot.x},${pot.y},${pot.floor ?? 0}:${pot.good.id}:${pot.good.flower ?? ""}`;

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
 * Where a ray hit: `tileOfHit`'s tile, and how far east and south of that tile's middle the hit
 * itself was, in tiles. A tap on the face of a wall between tiles lands on that wall's side of
 * the tile, which is how the build bar finds the line a 3D tap meant.
 */
export function spotOfHit(
  point: Vec,
  dir: Vec,
): { tile: Tile; within: { fx: number; fy: number } } {
  const tile = tileOfHit(point, dir);
  return { tile, within: { fx: point[0] - tile.x, fy: point[2] - tile.y } };
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

/**
 * What the 3D view says it shows: who is nearby, a few names and how many more. Only residents in
 * the world: someone asleep at home is never named as nearby.
 */
export function nearbyLabel(names: readonly string[]): string {
  if (names.length === 0) return "World view in 3D";
  const few = names.slice(0, 4);
  const more = names.length - few.length;
  return `World view in 3D. Nearby: ${few.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
}
