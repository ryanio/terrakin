import {
  imageDataUri,
  type PlotBlock,
  type PlotCard,
  type PlotCrop,
  type PlotGround,
  type PlotInk,
  type PlotPet,
  probeImage,
} from "@terrakin/cards";
import {
  alphaHex,
  type Biome,
  blockFill,
  CROP_HEX,
  FLOWER_TONES,
  GROUND_LOOK,
  groundTile,
  growth,
  HEARTH_COLOR,
  HEARTH_DOOR,
  isDecorKind,
  isFurnitureKind,
  LEAF_TONES,
  onVine,
  PAPER,
  PET_BOX,
  POND_LOOK,
  petBed,
  petShapes,
  seasonOf,
  THEME_INFO,
  THEME_TINT_ALPHA,
  type ThemePalette,
  tileHash,
  tileKey,
  tuftStroke,
  type WorldState,
  worldGround,
} from "@terrakin/sim";
import { shownPlotName } from "./plots";

/**
 * Plot photos (issue #34): a picture of a resident's plot, drawn with the world's own palette
 * (`packages/sim/src/palette.ts`, the same one `packages/client/src/render.ts` uses) and rasterized
 * by the cards pipeline. This file only reads the world and builds the data; drawing happens in
 * `packages/cards/`, in the Worker on Cloudflare (never in the World object) and in-process on
 * Node.
 */

/**
 * A plot photo before its home picture is loaded: `homeArt` is a media id, so the spec is plain
 * data that can cross from the World object to the Worker that draws it.
 */
export type PlotPhotoSpec = Omit<PlotCard, "homeArt" | "figures"> & {
  homeArt?: string | undefined;
};

/** Draws a spec as a PNG. Node draws in-process; the World object calls the Worker over RPC. */
export type PlotPhotoRenderer = (spec: PlotPhotoSpec) => Promise<Uint8Array>;

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

/**
 * The photo of `residentId`'s plot, from world state alone. Undefined when they have no plot. Its
 * name is the photo's title (decision 0121), unless `held` says staff hold back the words of
 * whoever named it.
 */
export function plotPhotoSpec(
  state: WorldState,
  residentId: string,
  held: (id: string) => boolean = () => false,
): PlotPhotoSpec | undefined {
  const plot = photoPlot(state, residentId);
  return plot ? plotSpecOf(state, plot, held) : undefined;
}

/** A world plot record, as `state.plots` keeps them. */
type WorldPlot = WorldState["plots"][string];

/**
 * A plot's photo from world state alone: plot photos (`plotPhotoSpec`) and the picture of a plot by
 * link (decision 0160). The owner's home picture comes along unless `withArt` is false.
 */
export function plotSpecOf(
  state: WorldState,
  plot: WorldPlot,
  held: (id: string) => boolean = () => false,
  withArt = true,
): PlotPhotoSpec {
  const title = shownPlotName(plot, held);
  const { config } = state;
  const S = config.plotSize;
  const x0 = plot.px * S;
  const y0 = plot.py * S;
  const owner = state.residents[plot.ownerId];
  const palette = owner?.theme ? THEME_INFO[owner.theme]?.palette : undefined;
  // Plots are never the Commons, so the ground is always the biome's.
  const area = areaOf(
    state,
    x0,
    y0,
    S,
    S,
    () => palette,
    () => false,
  );

  // The owner's hearth if it's on this plot, else the first hearth anyone keeps here.
  const onPlot = (h: { x: number; y: number } | null | undefined) =>
    h && h.x >= x0 && h.x < x0 + S && h.y >= y0 && h.y < y0 + S ? h : undefined;
  const hearth =
    onPlot(owner?.hearth) ??
    Object.values(state.residents)
      .map((r) => onPlot(r.hearth))
      .find((h) => h !== undefined);

  // The owner's pet, curled up beside their hearth where the map puts it (RFC 0019).
  const ownHearth = onPlot(owner?.hearth);
  const pet =
    owner?.pet && ownHearth
      ? petPicture(owner.pet, ownHearth, petBed(worldGround(state), ownHearth), x0, y0)
      : undefined;

  const biomes = [...area.biomes.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
  const { blocks, crops } = area;
  return {
    kind: "plot",
    name: owner?.name ?? "",
    ...(title === undefined ? {} : { title }),
    place: `Plot ${plot.px}, ${plot.py}`,
    facts: [biomeLine(biomes), `${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`],
    size: S,
    ground: area.ground,
    ...(palette ? { tint: alphaHex(palette.ground, THEME_TINT_ALPHA) } : {}),
    blocks,
    ...(crops.length > 0 ? { crops } : {}),
    ...(hearth ? { hearth: { x: hearth.x - x0, y: hearth.y - y0 } } : {}),
    ...(withArt && owner?.homeArt ? { homeArt: owner.homeArt } : {}),
    ...(pet ? { pet } : {}),
    ink: plotInk(season(state)),
  };
}

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
 * dressed for the season, paths and floors, blocks in the theme `palette` gives for their tile
 * (glass and water keep their own), and crops as far along as the world's day. Coordinates come
 * back relative to (x0, y0). `commons` says which tiles are the Commons plaza.
 */
export function areaOf(
  state: WorldState,
  x0: number,
  y0: number,
  cols: number,
  rows: number,
  palette: (x: number, y: number) => ThemePalette | undefined,
  commons: (x: number, y: number) => boolean,
): { ground: PlotGround[]; blocks: PlotBlock[]; crops: PlotCrop[]; biomes: Map<Biome, number> } {
  const { config } = state;
  const s = season(state);
  const ground: PlotGround[] = [];
  const biomes = new Map<Biome, number>();
  const blocks: PlotBlock[] = [];
  const crops: PlotCrop[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = x0 + x;
      const wy = y0 + y;
      const tile = groundTile(config, wx, wy, commons(wx, wy), s);
      biomes.set(tile.biome, (biomes.get(tile.biome) ?? 0) + 1);
      const sc = tile.scenery;
      const key = tileKey(wx, wy);
      // A path or floor (RFC 0016), in the same look the map draws.
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
      // Glass keeps its own color on a themed plot, as in the world, and so does water. A pond's
      // lily pads float where the map floats them (RFC 0023).
      const pond = block === "pond";
      blocks.push({
        x,
        y,
        glass: block === "glass",
        fill: blockFill(block, block === "glass" || pond ? undefined : palette(wx, wy)),
        ...(isDecorKind(block) ? { decor: block } : {}),
        ...(isFurnitureKind(block) ? { furniture: block } : {}),
        ...(pond ? { water: true } : {}),
        ...(pond && tileHash(wx, wy) % 3 === 0 ? { lily: true } : {}),
      });
    }
  }
  return { ground, blocks, crops, biomes };
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

/** Load the home picture. One that's missing or can't be drawn leaves the photo without it. */
export async function materializePlot(
  spec: PlotPhotoSpec,
  loadMedia: (id: string) => Promise<Uint8Array | undefined>,
): Promise<PlotCard> {
  const { homeArt, ...rest } = spec;
  if (!homeArt) return rest;
  const bytes = await loadMedia(homeArt).catch(() => undefined);
  const src = bytes ? imageDataUri(bytes) : undefined;
  const probe = bytes && src ? probeImage(bytes) : undefined;
  return probe && src
    ? { ...rest, homeArt: { src, width: probe.width, height: probe.height } }
    : rest;
}
