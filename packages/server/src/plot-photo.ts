import {
  imageDataUri,
  type PlacedFigure,
  type PlotArea,
  type PlotBlock,
  type PlotCard,
  type PlotCrop,
  type PlotFloor,
  type PlotFlooring,
  type PlotGround,
  type PlotInk,
  type PlotPet,
  type PlotRoofing,
  probeImage,
} from "@terrakin/cards";
import { floorName } from "@terrakin/protocol";
import {
  alphaHex,
  type Biome,
  type BlockKind,
  blockFill,
  blocksOn,
  CROP_HEX,
  DAY_LENGTH_MS,
  dayPhase,
  FLOORS,
  FLOWER_TONES,
  GROUND_LOOK,
  groundOn,
  groundTile,
  growth,
  HEARTH_COLOR,
  HEARTH_DOOR,
  isCommons,
  isDecorKind,
  isFurnitureKind,
  LEAF_TONES,
  nightAmount,
  onBridge,
  onVine,
  PAPER,
  PET_BOX,
  POND_LOOK,
  petBed,
  petShapes,
  plotKey,
  plotOf,
  plotRoof,
  type Resident,
  roofTone,
  SEA_LOOK,
  seaFrom,
  seasonOf,
  skyAt,
  standingFloor,
  THEME_INFO,
  THEME_TINT_ALPHA,
  type ThemePalette,
  tileHash,
  tileKey,
  timeOfDay,
  tuftStroke,
  type Weather,
  type WorldState,
  worldDayWords,
  worldGround,
} from "@terrakin/sim";
import { type EdgeLook, figureDrawing } from "@terrakin/ui/figure-svg";
import { shownPlotName } from "./plots";

/**
 * Plot photos (issue #34): a picture of a resident's plot, drawn with the world's own palette
 * (`packages/sim/src/palette.ts`, the same one `packages/client/src/render.ts` uses) and rasterized
 * by the cards pipeline. This file only reads the world and builds the data; drawing happens in
 * `packages/cards/`, in the Worker on Cloudflare (never in the World object) and in-process on
 * Node.
 */

/**
 * A resident's figure before it's drawn: where their feet are, in tiles, their look, and whether
 * flooring the picture draws over them hides them, so they're drawn faded (RFC 0028).
 */
export interface SpecFigure {
  x: number;
  y: number;
  look: EdgeLook;
  faded?: true;
}

/**
 * A plot photo before its pictures are drawn: `homeArt` is a media id and a figure is a look, so
 * the spec is plain data that can cross from the World object to the Worker that draws it.
 */
export type PlotPhotoSpec = Omit<PlotCard, "homeArt" | "figures"> & {
  homeArt?: string | undefined;
  figures?: SpecFigure[] | undefined;
};

/** What a photo needs from outside the world: the server's clock, and what staff hold back. */
export interface PhotoOptions {
  /** The server's clock, for the light and the sky the photo was taken under. */
  now: number;
  /** Whether staff hold back a resident's words (a quarantine): a plot name they gave stays out. */
  held?: ((id: string) => boolean) | undefined;
  /** The owner's own picture of their home comes along. Off where a picture may not be shown. */
  withArt?: boolean | undefined;
  /** That floor's plan instead of the home from above (RFC 0028). */
  floor?: number | undefined;
}

/** Draws a spec as a PNG. Node draws in-process; the World object calls the Worker over RPC. */
export type PlotPhotoRenderer = (spec: PlotPhotoSpec) => Promise<Uint8Array>;

/**
 * How many tiles of the world beyond a plot a picture of it shows on each side (issue #80). One
 * tile is a sliver: enough for the ground, a path, a fence or a neighbor's doorstep to run past
 * the edge, while the plot still fills four fifths of the frame.
 */
const SURROUND = 1;

const BIOME_WORDS: Record<Biome, string> = {
  meadow: "meadow",
  forest: "forest",
  stone: "stone",
  sand: "sand",
};

/** "Meadow", "Meadow and forest", "Meadow, forest, and stone". */
function biomeLine(biomes: Biome[]): string {
  const words = biomes.map((b) => BIOME_WORDS[b]);
  const line =
    words.length <= 2
      ? words.join(" and ")
      : `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * The plot a resident's photo shows: the one they own (the first, north to south, then west to
 * east), else the first plot shared with them. Undefined when they have neither.
 */
function photoPlot(state: WorldState, residentId: string) {
  const order = (a: { px: number; py: number }, b: { px: number; py: number }) =>
    a.py - b.py || a.px - b.px;
  const plots = Object.values(state.plots).sort(order);
  return (
    plots.find((p) => p.ownerId === residentId) ??
    plots.find((p) => p.coOwners?.includes(residentId))
  );
}

/** The plot `residentId`'s photo shows: the first they own, else the first shared with them. */
export function photoPlace(
  state: WorldState,
  residentId: string,
): { px: number; py: number } | undefined {
  const plot = photoPlot(state, residentId);
  return plot ? { px: plot.px, py: plot.py } : undefined;
}

/**
 * The photo of `residentId`'s plot, from world state alone. Undefined when they have no plot. Its
 * name is the photo's title (decision 0121), unless `held` says staff hold back the words of
 * whoever named it. With `floor`, one the plot has, it's that floor's plan (RFC 0028). It's
 * drawn to post (`posted`), where a post's card frames it.
 */
export function plotPhotoSpec(
  state: WorldState,
  residentId: string,
  o: PhotoOptions,
): PlotPhotoSpec | undefined {
  const plot = photoPlot(state, residentId);
  return plot ? { ...plotSpecOf(state, plot, o), posted: true } : undefined;
}

/** A world plot record, as `state.plots` keeps them. */
type WorldPlot = WorldState["plots"][string];

/**
 * A plot's photo from world state alone: plot photos (`plotPhotoSpec`) and the picture of a plot by
 * link (decision 0160). The owner's home picture comes along unless `withArt` is false. It shows
 * every floor from above (RFC 0028), or with `floor` that floor's plan: everything above
 * it left out, and what's under it dimmed where it has no flooring, as the map shows the floor you
 * stand on.
 */
export function plotSpecOf(state: WorldState, plot: WorldPlot, o: PhotoOptions): PlotPhotoSpec {
  const { floor } = o;
  const title = shownPlotName(plot, o.held ?? (() => false));
  const { config } = state;
  const S = config.plotSize;
  const x0 = plot.px * S;
  const y0 = plot.py * S;
  const owner = state.residents[plot.ownerId];

  // The box drawn: the plot with a sliver of the world on each side, kept inside the world's edges,
  // so a home reads as a place in a town (issue #80). A world too small for the slivers gets the
  // plot alone.
  const cols = Math.min(S + SURROUND * 2, config.width);
  const rows = Math.min(S + SURROUND * 2, config.height);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const bx = clamp(x0 - SURROUND, config.width - cols);
  const by = clamp(y0 - SURROUND, config.height - rows);
  // Where the plot sits in the box. It stays the subject: every count and every fact is its own.
  const at = { x: x0 - bx, y: y0 - by };
  const inPlot = (p: { x: number; y: number }) =>
    p.x >= at.x && p.x < at.x + S && p.y >= at.y && p.y < at.y + S;

  // Each plot's owner's theme, looked up once per plot, as the map around someone reads them.
  const themes = new Map<string, ThemePalette | undefined>();
  const paletteAt = (x: number, y: number) => {
    const { px, py } = plotOf(config, x, y);
    const key = plotKey(px, py);
    if (!themes.has(key)) {
      const res = state.plots[key] ? state.residents[state.plots[key].ownerId] : undefined;
      themes.set(key, res?.theme ? THEME_INFO[res.theme]?.palette : undefined);
    }
    return themes.get(key);
  };
  const commonsAt = (x: number, y: number) => {
    const { px, py } = plotOf(config, x, y);
    return isCommons(state, px, py);
  };
  const area = areaOf(
    state,
    bx,
    by,
    cols,
    rows,
    paletteAt,
    commonsAt,
    // Only the plot's own tiles name its ground, however much of the world around it is drawn.
    (x, y) => x >= x0 && x < x0 + S && y >= y0 && y < y0 + S,
  );

  // Each themed plot's tint over its own part of the box, the plot's own included.
  const tints: NonNullable<PlotArea["tints"]> = [];
  for (let py = Math.floor(by / S); py * S < by + rows; py++) {
    for (let px = Math.floor(bx / S); px * S < bx + cols; px++) {
      const theme = paletteAt(px * S, py * S);
      if (!theme || !state.plots[plotKey(px, py)]) continue;
      const left = Math.max(px * S, bx);
      const top = Math.max(py * S, by);
      tints.push({
        x: left - bx,
        y: top - by,
        w: Math.min((px + 1) * S, bx + cols) - left,
        h: Math.min((py + 1) * S, by + rows) - top,
        fill: alphaHex(theme.ground, THEME_TINT_ALPHA),
      });
    }
  }

  // The owner's hearth if it's on this plot, else the first hearth anyone keeps here.
  const onPlot = (h: { x: number; y: number } | null | undefined) =>
    h && h.x >= x0 && h.x < x0 + S && h.y >= y0 && h.y < y0 + S ? h : undefined;
  const hearth =
    onPlot(owner?.hearth) ??
    Object.values(state.residents)
      .map((r) => onPlot(r.hearth))
      .find((h) => h !== undefined);
  // The neighbors' homes standing in a sliver, so a sliver reads as somebody else's plot.
  const inBox = (h: { x: number; y: number }) =>
    h.x >= bx && h.x < bx + cols && h.y >= by && h.y < by + rows;
  const nearbyHearths: { x: number; y: number }[] = [];
  const seenHearth = new Set<string>();
  for (const res of Object.values(state.residents)) {
    const h = res.hearth;
    if (!h || onPlot(h) || !inBox(h)) continue;
    const key = `${h.x},${h.y}`;
    if (seenHearth.has(key)) continue;
    seenHearth.add(key);
    nearbyHearths.push({ x: h.x - bx, y: h.y - by });
  }

  // The owner's pet, curled up beside their hearth where the map puts it (RFC 0019).
  const ownHearth = onPlot(owner?.hearth);
  const pet =
    owner?.pet && ownHearth
      ? petPicture(owner.pet, ownHearth, petBed(worldGround(state), ownHearth), bx, by)
      : undefined;

  // The roofs of the homes around (RFC 0041), but never this plot's own, which lifts away the way
  // it does on the map when you stand there (`render.ts`: "every home's but the one you stand
  // on"). A photo has no "you" to lift it, and a roof drawn from above is opaque, so leaving it on
  // hid the whole subject: the hearth, the walls, the planters and the doorway. A floor plan asks
  // for none at all, since the point of one is seeing in.
  const roofs =
    floor === undefined
      ? roofsIn(state, bx, by, cols, rows, paletteAt, (px, py) => px !== plot.px || py !== plot.py)
      : [];
  // Whoever is standing on the plot, so a home with someone in it reads as one (issue #80). Only
  // the plot's own: a neighbor in their garden isn't the subject, and a photo is kept and posted.
  const figures = figuresIn(
    state,
    bx,
    by,
    cols,
    rows,
    { x: x0 + S / 2, y: y0 + S / 2 },
    roofs,
  ).filter(inPlot);
  // The moment the picture shows: the map's own light and weather (decision 0300).
  const sky = skyAt(o.now, state.day);
  const phase = dayPhase(o.now, DAY_LENGTH_MS);

  const biomes = [...area.biomes.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
  const { blocks, crops } = area;
  // Upstairs is the plot's own: a neighbor's loft in a sliver would otherwise lay its shadow over
  // the plot's edge, escape a floor plan's dim, and count as a floor the owner added.
  const upstairs = area.floors.map((f) => ({
    flooring: f.flooring.filter(inPlot),
    blocks: f.blocks.filter(inPlot),
  }));
  // Every block on the plot counts, on every floor, as the plot's view counts them. A block in a
  // sliver belongs to a neighbor, so it's drawn and never counted.
  const count =
    blocks.filter(inPlot).length + upstairs.reduce((sum, s) => sum + s.blocks.length, 0);
  const added = plot.floors ?? 0;
  const shown = floor === undefined ? drawnFromAbove(upstairs) : upstairs.slice(0, floor);
  return {
    kind: "plot",
    name: owner?.name ?? "",
    ...(title === undefined ? {} : { title }),
    place: `Plot ${plot.px}, ${plot.py}`,
    facts: [
      biomeLine(biomes),
      `${count} ${count === 1 ? "block" : "blocks"}`,
      ...(floor !== undefined ? [floorName(floor)] : added > 0 ? [`${added + 1} floors`] : []),
    ],
    size: S,
    ...(cols > S || rows > S ? { surround: { cols, rows, x: at.x, y: at.y } } : {}),
    ground: area.ground,
    ...(tints.length > 0 ? { tints } : {}),
    blocks,
    ...(shown.length > 0 ? { floors: shown } : {}),
    ...(roofs.length > 0 ? { roofs } : {}),
    ...(floor !== undefined && floor > 0 ? { floorPlan: true } : {}),
    ...(crops.length > 0 ? { crops } : {}),
    ...(hearth ? { hearth: { x: hearth.x - bx, y: hearth.y - by } } : {}),
    ...(nearbyHearths.length > 0 ? { hearths: nearbyHearths } : {}),
    ...(o.withArt !== false && owner?.homeArt ? { homeArt: owner.homeArt } : {}),
    ...(pet ? { pet } : {}),
    ...(figures.length > 0 ? { figures } : {}),
    // Night in twentieths, so a plot's picture by link changes with the light, not every second.
    sky: { night: Math.round(nightAmount(phase) * 20) / 20, weather: sky.weather },
    stamp: stampOf(state, phase, sky.weather),
    ink: plotInk(season(state)),
  };
}

const TIME_WORDS = { dawn: "Dawn", day: "Day", dusk: "Dusk", night: "Night" } as const;
const WEATHER_WORDS = {
  clear: "Clear",
  cloudy: "Cloudy",
  rain: "Rain",
  fog: "Fog",
  snow: "Snow",
} as const;
const SEASON_WORDS = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
} as const;

/**
 * The stamp along the foot of a photo: the day it was taken, the season, the time of day when it
 * isn't plain daylight (which is when the picture itself looks different), and the weather. Our own
 * words from the world's own day and clock, never anything a resident wrote. A world that has never
 * counted a day has no day and no season to stamp.
 */
function stampOf(state: WorldState, phase: number, weather: Weather): string[] {
  const time = timeOfDay(phase);
  return [
    ...(state.day === undefined
      ? []
      : [worldDayWords(state.day), SEASON_WORDS[seasonOf(state.day)]]),
    ...(time === "day" ? [] : [TIME_WORDS[time]]),
    WEATHER_WORDS[weather],
  ];
}

/** The floors a picture from above draws: up to the highest with something on it. */
export function drawnFromAbove(floors: PlotFloor[]): PlotFloor[] {
  let top = floors.length;
  while (top > 0 && !hasAnything(floors[top - 1])) top--;
  return floors.slice(0, top);
}

const hasAnything = (s: PlotFloor | undefined) =>
  s !== undefined && (s.flooring.length > 0 || s.blocks.length > 0);

/** The world's season, as the map draws it: leaves in autumn, snow in winter. */
const season = (state: WorldState) => (state.day === undefined ? undefined : seasonOf(state.day));

/** The colors a photo draws beyond the ground and blocks, from the sim's palette. */
export function plotInk(s: ReturnType<typeof seasonOf> | undefined): PlotInk {
  return {
    roof: HEARTH_COLOR,
    door: HEARTH_DOOR,
    walls: PAPER,
    tuft: tuftStroke(s),
    pond: {
      shade: POND_LOOK.shade,
      stone: POND_LOOK.stone,
      pebble: POND_LOOK.pebble,
      lily: POND_LOOK.lily,
      glint: POND_LOOK.glint,
    },
  };
}

/**
 * A rectangle of the world, `cols` by `rows` tiles from (x0, y0), as a photo draws it: its ground
 * dressed for the season, paths and flooring, blocks in the theme `palette` gives for their tile
 * (glass and water keep their own), crops as far along as the world's day, and each floor above
 * the ground floor up to `FLOORS.max` (RFC 0028), its flooring and blocks, empty or not. Coordinates
 * come back relative to (x0, y0). `commons` says which tiles are the Commons plaza. `counts` says
 * which tiles count toward `biomes`, so a photo that shows slivers of the world around a plot still
 * describes the plot's own ground (issue #80); without it every tile in the box counts.
 */
/**
 * The roofs of the homes in a box of the world (RFC 0041), their tiles counted from its top left,
 * each in its covering's own color on that plot's theme. `only` chooses which plots' roofs are
 * drawn: a plot photo passes every plot but its own, so the subject's roof lifts away as it does
 * on the map, while the neighbors' stay on in the sliver around it, where their hearths and blocks
 * are drawn too (decision 0306). A floor plan asks for none, since the point of one is seeing in.
 */
export function roofsIn(
  state: WorldState,
  bx: number,
  by: number,
  cols: number,
  rows: number,
  palette: (x: number, y: number) => ThemePalette | undefined,
  only?: (px: number, py: number) => boolean,
): PlotRoofing[] {
  const { plotSize } = state.config;
  const roofs: PlotRoofing[] = [];
  for (let py = Math.floor(by / plotSize); py <= Math.floor((by + rows - 1) / plotSize); py++) {
    for (let px = Math.floor(bx / plotSize); px <= Math.floor((bx + cols - 1) / plotSize); px++) {
      if (only && !only(px, py)) continue;
      const shape = plotRoof(state, px, py);
      if (!shape) continue;
      roofs.push({
        // Snow lies on it all winter (RFC 0041), as it lies on the ground under it.
        fill: roofTone(
          blockFill(shape.material, palette(px * plotSize, py * plotSize)),
          season(state),
        ),
        tiles: shape.tiles.map((t) => ({ x: t.x - bx, y: t.y - by, h: t.h })),
        // What stands on its ridge, counted from the box like its tiles.
        ...(shape.top
          ? { top: { kind: shape.top.kind, x: shape.top.x - bx, y: shape.top.y - by } }
          : {}),
      });
    }
  }
  return roofs;
}

export function areaOf(
  state: WorldState,
  x0: number,
  y0: number,
  cols: number,
  rows: number,
  palette: (x: number, y: number) => ThemePalette | undefined,
  commons: (x: number, y: number) => boolean,
  counts?: (x: number, y: number) => boolean,
): {
  ground: PlotGround[];
  blocks: PlotBlock[];
  crops: PlotCrop[];
  floors: PlotFloor[];
  biomes: Map<Biome, number>;
} {
  const { config } = state;
  const s = season(state);
  // The sim's own rule for the water, so a picture and the world agree on where it is.
  const sea = seaFrom(config, state.lands);
  const bridge = sea ? (x: number, y: number) => onBridge(state, x, y) : undefined;
  const ground: PlotGround[] = [];
  const biomes = new Map<Biome, number>();
  const blocks: PlotBlock[] = [];
  const crops: PlotCrop[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = x0 + x;
      const wy = y0 + y;
      const tile = groundTile(config, wx, wy, commons(wx, wy), s);
      if (!counts || counts(wx, wy)) biomes.set(tile.biome, (biomes.get(tile.biome) ?? 0) + 1);
      const key = tileKey(wx, wy);
      // Water, and the planks across it, in place of the ground (RFC 0038). The map and the 3D
      // view draw both; without this a photo of an island's shore, and the map around anyone
      // standing on the bridge, came back as meadow with flowers on the open channel.
      if (sea?.(wx, wy) === true) {
        ground.push({ fill: SEA_LOOK.water });
        continue;
      }
      if (bridge?.(wx, wy) === true) {
        ground.push({ fill: SEA_LOOK.deck });
        continue;
      }
      const sc = tile.scenery;
      // A path or flooring (RFC 0016), in the same look the map draws.
      const laid = state.ground?.[key];
      const look = laid ? GROUND_LOOK[laid] : undefined;
      ground.push({
        fill: tile.fill,
        ...(look
          ? { paving: { ...(look.fill ? { fill: look.fill } : {}), marks: look.marks } }
          : {}),
        ...(sc?.kind === "tuft" ? { tuft: sc.fx } : {}),
        ...(sc?.kind === "flower"
          ? { flower: { fx: sc.fx, fy: sc.fy, fill: FLOWER_TONES[sc.tone] } }
          : {}),
        ...(sc?.kind === "leaf"
          ? { leaf: { fx: sc.fx, fy: sc.fy, turn: sc.turn, fill: LEAF_TONES[sc.tone] } }
          : {}),
      });
      // The area's own tiles, row by row: cols * rows lookups, however big the world is.
      const block = state.blocks[key];
      if (!block) continue;
      // What grows in a planter, as far along as the world's day has it, as the map draws it.
      const planting = state.items?.crops[key];
      if (planting) {
        crops.push({
          x,
          y,
          crop: planting.crop,
          done: growth(planting.plantedDay, planting.readyDay, state.day),
          fill: CROP_HEX[planting.crop],
          ...(onVine(planting.crop) ? { vine: true } : {}),
        });
      }
      blocks.push(plotBlock(block, x, y, wx, wy, palette));
    }
  }
  // Each floor above the ground floor, read over the area's own tiles like the ground floor.
  const floors: PlotFloor[] = [];
  for (let floor = 1; floor <= FLOORS.max; floor++) {
    const upBlocks = blocksOn(state, floor);
    const upGround = groundOn(state, floor);
    const flooring: PlotFlooring[] = [];
    const standing: PlotBlock[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const key = tileKey(x0 + x, y0 + y);
        const laid = upGround[key];
        if (laid) {
          const look = GROUND_LOOK[laid];
          flooring.push({
            x,
            y,
            paving: { ...(look.fill ? { fill: look.fill } : {}), marks: look.marks },
          });
        }
        const block = upBlocks[key];
        if (block) standing.push(plotBlock(block, x, y, x0 + x, y0 + y, palette));
      }
    }
    floors.push({ flooring, blocks: standing });
  }
  return { ground, blocks, crops, floors, biomes };
}

/**
 * A block as a photo draws it, at (x, y) in the area, from world tile (wx, wy). Glass keeps its
 * own color on a themed plot, as in the world, and so does water. A pond's lily pads float where
 * the map floats them (RFC 0023).
 */
function plotBlock(
  block: BlockKind,
  x: number,
  y: number,
  wx: number,
  wy: number,
  palette: (x: number, y: number) => ThemePalette | undefined,
): PlotBlock {
  const pond = block === "pond";
  return {
    x,
    y,
    glass: block === "glass",
    fill: blockFill(block, block === "glass" || pond ? undefined : palette(wx, wy)),
    ...(isDecorKind(block) ? { decor: block } : {}),
    ...(isFurnitureKind(block) ? { furniture: block } : {}),
    ...(pond ? { water: true } : {}),
    ...(pond && tileHash(wx, wy) % 3 === 0 ? { lily: true } : {}),
  };
}

/** A pet's box across, in tiles, as the map draws it, and how far it leans toward the hearth. */
const PET_TILES = 1;
const SNUGGLE = 0.32;

/** A pet asleep on `bed`, snuggled toward `hearth`, as a plot photo draws it. */
export function petPicture(
  pet: NonNullable<WorldState["residents"][string]["pet"]>,
  hearth: { x: number; y: number },
  bed: { x: number; y: number },
  x0: number,
  y0: number,
): PlotPet {
  const cx = bed.x - x0 + 0.5 + (hearth.x - bed.x) * SNUGGLE;
  const feet = bed.y - y0 + 0.5 + (hearth.y - bed.y) * SNUGGLE + 0.32;
  return {
    x: cx - PET_TILES / 2,
    y: feet - (PET_TILES * 42.5) / PET_BOX,
    size: PET_TILES,
    ...(hearth.x < bed.x ? { flip: true } : {}),
    shapes: petShapes(pet.kind, pet.coat, "asleep"),
  };
}

/** Most figures a picture draws, nearest first. Each costs a few hundred shapes. */
const MAX_FIGURES = 16;
/** Where a figure's feet are in its tile, as the map stands it. */
export const FEET = 0.88;

/** A resident's look as a picture draws it: no uploaded pattern tile, ever. */
export function edgeLook(r: Resident): EdgeLook {
  const styles = r.wearStyle
    ? Object.fromEntries(
        Object.entries(r.wearStyle).filter(
          (e): e is [string, NonNullable<(typeof e)[1]>] => e[1] != null,
        ),
      )
    : undefined;
  return {
    color: r.color,
    shape: r.shape,
    ...(r.theme ? { theme: r.theme } : {}),
    ...(r.pattern ? { pattern: r.pattern } : {}),
    ...(r.wear?.length ? { wear: [...r.wear] } : {}),
    ...(styles && Object.keys(styles).length ? { wearStyle: styles } : {}),
    ...(r.hair ? { hair: r.hair } : {}),
    ...(r.hairColor ? { hairColor: r.hairColor } : {}),
  };
}

/**
 * Whether a picture from above draws flooring or a block over someone on `floor` at (x, y), as the
 * map's `underFlooring` has it for every plot but the one you stand on.
 */
function underFlooring(state: WorldState, x: number, y: number, floor: number): boolean {
  const key = tileKey(x, y);
  for (let above = floor + 1; above <= FLOORS.max; above++) {
    if (blocksOn(state, above)[key] !== undefined || groundOn(state, above)[key] !== undefined) {
      return true;
    }
  }
  return false;
}

/** Online residents standing in the box from (x0, y0), `cols` by `rows`, nearest `here` first. */
export function figuresIn(
  state: WorldState,
  x0: number,
  y0: number,
  cols: number,
  rows: number,
  here: { x: number; y: number },
  roofs: PlotRoofing[] = [],
): SpecFigure[] {
  // Someone inside a home whose roof the picture draws is under it, and fades as someone under
  // flooring does (RFC 0041), so a figure never stands on a roof the way the map never lets one.
  const roofed = new Set(roofs.flatMap((r) => r.tiles.map((t) => `${t.x},${t.y}`)));
  return Object.values(state.residents)
    .filter((r) => r.online && r.x >= x0 && r.x < x0 + cols && r.y >= y0 && r.y < y0 + rows)
    .sort(
      (a, b) =>
        Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y) ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, MAX_FIGURES)
    .map((r) => ({
      x: r.x - x0 + 0.5,
      y: r.y - y0 + FEET,
      look: edgeLook(r),
      ...(underFlooring(state, r.x, r.y, standingFloor(r)) || roofed.has(`${r.x - x0},${r.y - y0}`)
        ? { faded: true as const }
        : {}),
    }));
}

/** Figures drawn from their looks, with the map's own recorder. Never in the World object. */
export const drawnFigures = (figures: SpecFigure[] | undefined): PlacedFigure[] =>
  (figures ?? []).map((f) => ({
    x: f.x,
    y: f.y,
    drawing: figureDrawing(f.look),
    ...(f.faded ? { faded: true } : {}),
  }));

/**
 * The photo's card: its figures drawn and the home picture loaded. One that's missing or can't be
 * drawn leaves the photo without it.
 */
export async function materializePlot(
  spec: PlotPhotoSpec,
  loadMedia: (id: string) => Promise<Uint8Array | undefined>,
): Promise<PlotCard> {
  const { homeArt, figures, ...rest } = spec;
  const card: PlotCard = {
    ...rest,
    ...(figures?.length ? { figures: drawnFigures(figures) } : {}),
  };
  if (!homeArt) return card;
  const bytes = await loadMedia(homeArt).catch(() => undefined);
  const src = bytes ? imageDataUri(bytes) : undefined;
  const probe = bytes && src ? probeImage(bytes) : undefined;
  return probe && src
    ? { ...card, homeArt: { src, width: probe.width, height: probe.height } }
    : card;
}
