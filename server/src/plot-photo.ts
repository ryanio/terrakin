import {
  imageDataUri,
  type PlotBlock,
  type PlotCard,
  type PlotGround,
  probeImage,
} from "@terrakin/cards";
import {
  alphaHex,
  type Biome,
  blockFill,
  FLOWER_TONES,
  groundTile,
  HEARTH_COLOR,
  HEARTH_DOOR,
  isDecorKind,
  LEAF_TONES,
  PAPER,
  seasonOf,
  THEME_INFO,
  THEME_TINT_ALPHA,
  tileKey,
  tuftStroke,
  type WorldState,
} from "@terrakin/sim";

/**
 * Plot photos (issue #34): a picture of a resident's plot, drawn with the world's own palette
 * (`sim/src/palette.ts`, the same one `client/src/render.ts` uses) and rasterized by the cards
 * pipeline. This file only reads the world and builds the data; drawing happens in `cards/`, in
 * the Worker on Cloudflare (never in the World object) and in-process on Node.
 */

/**
 * A plot photo before its home picture is loaded: `homeArt` is a media id, so the spec is plain
 * data that can cross from the World object to the Worker that draws it.
 */
export type PlotPhotoSpec = Omit<PlotCard, "homeArt"> & { homeArt?: string | undefined };

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
export function photoPlot(state: WorldState, residentId: string) {
  const order = (a: { px: number; py: number }, b: { px: number; py: number }) =>
    a.py - b.py || a.px - b.px;
  const plots = Object.values(state.plots).sort(order);
  return (
    plots.find((p) => p.ownerId === residentId) ??
    plots.find((p) => p.coOwners?.includes(residentId))
  );
}

/** The photo of `residentId`'s plot, from world state alone. Undefined when they have no plot. */
export function plotPhotoSpec(state: WorldState, residentId: string): PlotPhotoSpec | undefined {
  const plot = photoPlot(state, residentId);
  if (!plot) return undefined;
  const { config } = state;
  const S = config.plotSize;
  const x0 = plot.px * S;
  const y0 = plot.py * S;
  const owner = state.residents[plot.ownerId];
  const palette = owner?.theme ? THEME_INFO[owner.theme]?.palette : undefined;
  // The world's season, as the map draws it: leaves in autumn, snow in winter.
  const season = state.day === undefined ? undefined : seasonOf(state.day);

  const ground: PlotGround[] = [];
  const biomeCounts = new Map<Biome, number>();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Plots are never the Commons, so the ground is always the biome's.
      const tile = groundTile(config, x0 + x, y0 + y, false, season);
      biomeCounts.set(tile.biome, (biomeCounts.get(tile.biome) ?? 0) + 1);
      const s = tile.scenery;
      ground.push({
        fill: tile.fill,
        ...(s?.kind === "tuft" ? { tuft: s.fx } : {}),
        ...(s?.kind === "flower"
          ? { flower: { fx: s.fx, fy: s.fy, fill: FLOWER_TONES[s.tone] } }
          : {}),
        ...(s?.kind === "leaf"
          ? { leaf: { fx: s.fx, fy: s.fy, turn: s.turn, fill: LEAF_TONES[s.tone] } }
          : {}),
      });
    }
  }

  // The plot's own tiles, row by row: S * S lookups, however big the world is.
  const blocks: PlotBlock[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const block = state.blocks[tileKey(x0 + x, y0 + y)];
      if (!block) continue;
      // Glass keeps its own color on a themed plot, as in the world.
      blocks.push({
        x,
        y,
        glass: block === "glass",
        fill: blockFill(block, block === "glass" ? undefined : palette),
        ...(isDecorKind(block) ? { decor: block } : {}),
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

  const biomes = [...biomeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
  return {
    kind: "plot",
    name: owner?.name ?? "",
    place: `Plot ${plot.px}, ${plot.py}`,
    facts: [biomeLine(biomes), `${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`],
    size: S,
    ground,
    ...(palette ? { tint: alphaHex(palette.ground, THEME_TINT_ALPHA) } : {}),
    blocks,
    ...(hearth ? { hearth: { x: hearth.x - x0, y: hearth.y - y0 } } : {}),
    ...(owner?.homeArt ? { homeArt: owner.homeArt } : {}),
    ink: { roof: HEARTH_COLOR, door: HEARTH_DOOR, walls: PAPER, tuft: tuftStroke(season) },
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
