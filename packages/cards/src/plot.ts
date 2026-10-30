/**
 * A plot photo (issue #34): one resident's plot drawn from above, in the world's own palette, as
 * SVG markup the card template places in a photo frame. The server fills a `PlotCard` from the
 * world (`packages/server/src/plot-photo.ts`): every color comes from the sim's palette and every
 * number from world state. Nothing a resident wrote reaches this markup; their name is drawn by the
 * template as text, and their home picture as an image checked by `imageDataUri`.
 *
 * The shapes follow `packages/client/src/render.ts`, so a photo looks like the plot does in the
 * world.
 */

import { safeColor } from "./color";
import { type Drawing, drawingBox, drawingSvg } from "./drawing";
import { type Sky, skyParts } from "./sky";

export { safeColor };

/**
 * One shape of a path or flooring, in tile units from the tile's top left, as the sim's palette gives
 * it (`GROUND_LOOK`). Colors are checked by `safeColor`; numbers are kept to the tile.
 */
export type PlotMark =
  | { shape: "rect"; x: number; y: number; w: number; h: number; r: number; fill: string }
  | { shape: "circle"; cx: number; cy: number; r: number; fill: string }
  | {
      shape: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      turn: number;
      fill: string;
    }
  | {
      shape: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      stroke: string;
    };

/** A path or flooring on a tile (RFC 0016): its color, if it covers the tile, and its shapes. */
export interface PlotPaving {
  fill?: string | undefined;
  marks: readonly PlotMark[];
}

/** One tile of ground: its tone, and the tuft, flower, or fallen leaf on it. */
export interface PlotGround {
  fill: string;
  /** A grass tuft, by where it stands across the tile (0 to 1). */
  tuft?: number | undefined;
  /** A flower, by where it sits in the tile (0 to 1 each way), and its color. */
  flower?: { fx: number; fy: number; fill: string } | undefined;
  /** An autumn leaf: where it lies in the tile, its turn in radians from east, and its color. */
  leaf?: { fx: number; fy: number; turn: number; fill: string } | undefined;
  /** A path or flooring laid on the tile. Nothing grows through it. */
  paving?: PlotPaving | undefined;
}

/** Decor from the town shop, drawn as itself rather than a square. Same names as the sim's. */
export const PLOT_DECOR = [
  "lantern",
  "frame",
  "fence",
  "bench",
  "hay_bale",
  "scarecrow",
  "bat_bunting",
  "cauldron",
  "candy_bowl",
  "snowman",
  "string_lights",
  "little_fir",
  "sled",
  "cornucopia",
  "leaf_garland",
  "menorah",
  "dreidel",
  "stocking",
  "bird_bath",
  "beehive",
] as const;
export type PlotDecor = (typeof PLOT_DECOR)[number];

/** Furniture from the workbench (RFC 0016), drawn as itself. Same names as the sim's. */
export const PLOT_FURNITURE = [
  "table",
  "chair",
  "bookshelf",
  "barrel",
  "signpost",
  "lamp_post",
  "well",
  "stone_wall",
  "campfire",
  "flower_box",
  "jack_o_lantern",
  // Cozy homes (RFC 0044): the pieces you rest on.
  "armchair",
  "sofa",
  "bed",
  // Roomier homes (RFC 0050): surfaces that hold a small thing on top.
  "desk",
  "side_table",
  "dresser",
  // More for a home: furniture made at a workbench.
  "wardrobe",
  "rocking_chair",
  "piano",
  "bathtub",
  "fireplace",
  "aquarium",
  "coffee_table",
  "coat_rack",
  "floor_lamp",
  "potted_tree",
] as const;
export type PlotFurniture = (typeof PLOT_FURNITURE)[number];

export interface PlotBlock {
  /** Tiles from the plot's top left corner. */
  x: number;
  y: number;
  glass: boolean;
  fill: string;
  /** Set for decor from the town shop; `fill` is then its main color. */
  decor?: PlotDecor | undefined;
  /** Set for a piece of furniture; `fill` is then its main color. */
  furniture?: PlotFurniture | undefined;
  /**
   * A tile of pond (RFC 0023): flat in the ground in `ink.pond`'s colors, with a stone rim along
   * each side that doesn't run on into more pond. `fill` is then its water.
   */
  water?: boolean | undefined;
  /** A lily pad floats on this tile of pond, as on the map. */
  lily?: boolean | undefined;
  /**
   * A wall's surface (bricks, beams, boards, panes) as the sim's `WALL_LOOK` gives it, in units of
   * the block's face, drawn over `fill` as the map draws it.
   */
  marks?: readonly PlotMark[] | undefined;
}

/** Flooring laid on a floor above the ground floor (RFC 0028): its tile and its look. */
export interface PlotFlooring {
  /** Tiles from the area's top left corner. */
  x: number;
  y: number;
  paving: PlotPaving;
}

/**
 * A floor above the ground floor (RFC 0028): its flooring and the blocks on it, drawn from above
 * over the floors under it, as the map draws them.
 */
export interface PlotFloor {
  flooring: PlotFlooring[];
  blocks: PlotBlock[];
}

/**
 * A home's roof from above (RFC 0041): the tiles it covers and how high each of their corners
 * stands, from 0 at the eave to 1 along the ridge, as the sim's `roofShape` works them out. The
 * card draws the same slopes the map does, so a photo of a home matches the home.
 */
/**
 * What stands on a roof's ridge (RFC 0041). The names are the sim's `ROOF_TOPS`; this package
 * depends on nothing in the repo, so they're written out, and an unknown one draws nothing.
 */
type PlotRoofTop = "vane" | "flag" | "nest";

export interface PlotRoofing {
  /** The block it's covered in, as a color. */
  fill: string;
  /**
   * A graded covering (RFC 0051): a deep band along its eaves with a light line inside it, and for
   * a masterwork one a carved diamond on its highest tile, as the map draws them.
   */
  grade?: PlotGrade | undefined;
  /** What stands on its ridge and the tile it stands on, absent while the ridge is bare. */
  top?: { kind: PlotRoofTop; x: number; y: number } | undefined;
  tiles: {
    /** Tiles from the area's top left corner. */
    x: number;
    y: number;
    /**
     * Four heights, north-west, north-east, south-east, south-west. A plain array rather than a
     * tuple because a spec crosses a Cloudflare RPC boundary, which rewrites tuples as arrays.
     */
    h: number[];
  }[];
}

/** Something growing in a planter, drawn over it as the map draws it. */
export interface PlotCrop {
  /** Tiles from the plot's top left corner: the planter's tile. */
  x: number;
  y: number;
  /** The sim's name for it. */
  crop: string;
  /** How far along it is: 0 just planted, 1 ready to pick. */
  done: number;
  /** Its color once it's ready, from the sim's palette (its look in the catalog). */
  fill: string;
  /** Set when it grows on a vine along the soil, like a pumpkin; the rest grow on a stem. */
  vine?: boolean | undefined;
}

/** The colors the drawing needs beyond the ground and blocks, from the sim's palette. */
export interface PlotInk {
  roof: string;
  door: string;
  walls: string;
  tuft: string;
  /** A pond's colors beside its water (RFC 0023): the shade by its banks, its rim, and more. */
  pond?: PlotPondInk | undefined;
}

/** How a pond is drawn in a photo, from the sim's `POND_LOOK`. */
export interface PlotPondInk {
  shade: string;
  stone: string;
  pebble: string;
  lily: string;
  glint: string;
}

/** A pond's colors when a card names none: the sim's own, so a photo never shows a plain square. */
const POND_INK: PlotPondInk = {
  shade: "rgba(28, 64, 96, 0.22)",
  stone: "#c4beb2",
  pebble: "#8f887c",
  lily: "#6fae4c",
  glint: "#ffffff",
};

/**
 * A pet asleep by the hearth (RFC 0019), from the pictures the sim keeps as data: plain shapes whose
 * every attribute is a number, a color, a path of numbers, or a fixed word, all checked here.
 */
export interface PlotPet {
  /** Its box's top left corner, in tiles from the plot's, and the box's side in tiles. */
  x: number;
  y: number;
  size: number;
  /** Faces left. */
  flip?: boolean | undefined;
  shapes: { tag: string; attrs: Record<string, string | number> }[];
}

export interface PlotCard {
  kind: "plot";
  /** The owner's name, untrusted: drawn as text, or "A resident" when nothing in it can be drawn. */
  name: string;
  /**
   * The plot's own name (decision 0121), untrusted: drawn as text as the photo's title, with the
   * owner's home under it. Without it, or when nothing in it can be drawn, the owner's home is the
   * title.
   */
  title?: string | undefined;
  /** Where it is, in our own words, like "Plot 3, 2". */
  place: string;
  /** Short lines under the photo in our own words, like "Meadow and forest" or "24 blocks". */
  facts: string[];
  /**
   * One line of what is new on the plot since this resident's last photo, in our own words, like
   * "New since your last photo: 4 blocks, a pet" (issue #80). Left out when nothing is new.
   */
  story?: string | undefined;
  /** The plot's tiles per side. With `surround`, the drawn box is wider than this. */
  size: number;
  /**
   * The drawn box, row by row from its top left: `size * size` tiles for the plot alone, or
   * `surround.cols * surround.rows` with slivers of the world around it.
   */
  ground: PlotGround[];
  /**
   * Slivers of the world around the plot, so a home reads as a place in a town rather than a
   * floating square (issue #80): the whole drawn box in tiles, and where the plot sits in it. The
   * plot stays the subject, so what lies outside it is washed back. Without this the box is the
   * plot alone.
   */
  surround?: { cols: number; rows: number; x: number; y: number } | undefined;
  /** Theme tints over parts of the box: each plot's owner's, over that plot. */
  tints?: { x: number; y: number; w: number; h: number; fill: string }[] | undefined;
  blocks: PlotBlock[];
  /** What's growing in the plot's planters. */
  crops?: PlotCrop[] | undefined;
  /** The hearth's tile, when it's on this plot. */
  hearth?: { x: number; y: number } | undefined;
  /** The neighbors' hearths standing in the slivers around the plot, so their homes show too. */
  hearths?: { x: number; y: number }[] | undefined;
  /** The owner's own picture of their home, standing over the hearth (a data URI and its size). */
  homeArt?: { src: string; width: number; height: number } | undefined;
  /** The owner's pet, curled up by the hearth. */
  pet?: PlotPet | undefined;
  /** Residents standing on the plot (pictures by link, decision 0160). */
  figures?: PlacedFigure[] | undefined;
  /** Floors above the ground floor, from floor 1 up (RFC 0028). */
  floors?: PlotFloor[] | undefined;
  /** The top floor drawn is a floor plan: what's under it shows through dimmed where it has no flooring. */
  floorPlan?: boolean | undefined;
  /** The home's roof (RFC 0041), over everything standing in it, as the map draws it. */
  roofs?: PlotRoofing[] | undefined;
  /** Walls between tiles on the ground floor (RFC 0050), each on a tile's `n` or `w` line. */
  edges?: PlotEdge[] | undefined;
  /**
   * A photo taken to post on Terrakin, where the post's card frames it and may crop its sides: no
   * card border, the brand on the photo's own frame, and room all round the frame.
   */
  posted?: boolean | undefined;
  /** The moment it shows: the map's light and the weather, drawn over the plot (decision 0300). */
  sky?: Sky | undefined;
  /** The stamp under the caption, in our own words, like "Day 13 of Terrakin", "Autumn", "Rain". */
  stamp?: string[] | undefined;
  ink: PlotInk;
}

/** A resident's figure standing with their feet at `x`, `y`, in tiles from the area's top left. */
export interface PlacedFigure {
  x: number;
  y: number;
  drawing: Drawing;
  /** Under flooring the picture draws over them: drawn faded, as the map draws them (RFC 0028). */
  faded?: boolean | undefined;
}

/**
 * A piece of the world from above: `cols` by `rows` tiles and what stands on them, in the same
 * shapes as a plot photo. A plot photo is one plot's area; the picture of where someone is
 * (decision 0160) is a wider one.
 */
export interface PlotArea {
  cols: number;
  rows: number;
  /** `cols * rows` tiles, row by row from the top left. */
  ground: PlotGround[];
  /** Theme tints laid over parts of the area: each plot's owner's, over that plot. */
  tints?: { x: number; y: number; w: number; h: number; fill: string }[] | undefined;
  blocks: PlotBlock[];
  /** Walls between tiles (RFC 0050), drawn over the blocks. */
  edges?: PlotEdge[] | undefined;
  crops?: PlotCrop[] | undefined;
  hearths?: { x: number; y: number }[] | undefined;
  pets?: PlotPet[] | undefined;
  figures?: PlacedFigure[] | undefined;
  /**
   * Floors above the ground floor, from floor 1 up (RFC 0028), each drawn over the ones under
   * it with a shadow that falls further the higher it is, so height reads at a glance.
   */
  floors?: PlotFloor[] | undefined;
  /**
   * The top floor in `floors` is a floor plan, as the map shows the floor you stand on: what's
   * under it shows through dimmed wherever it has no flooring.
   */
  floorPlan?: boolean | undefined;
  /** The roofs of the homes in the area (RFC 0041), over everything standing in them. */
  roofs?: PlotRoofing[] | undefined;
  /** A ring on the ground under someone, drawn under the figures standing in the area. */
  ring?: { x: number; y: number } | undefined;
  /**
   * The part of the area the picture is about (issue #80). Everything outside it is washed back
   * with paper, under the sky, so slivers of the world around a plot read as the edges of a place
   * without pulling the eye off the plot itself.
   */
  subject?: { x: number; y: number; w: number; h: number } | undefined;
  /** The weather and the map's light at the moment drawn, over everything standing in the area. */
  sky?: Sky | undefined;
  ink: PlotInk;
}

const n = (v: number) => Number(v.toFixed(3));

/**
 * A wall between tiles (RFC 0050) as a plot photo carries it: its tile in the drawn box, its `n` or
 * `w` line, and its color. A `door` is drawn as a door, a `pane` as a window.
 */
export interface PlotEdge {
  x: number;
  y: number;
  side: "n" | "w";
  fill: string;
  door?: true | undefined;
  pane?: true | undefined;
  /** A graded made material (RFC 0051): its plinth and cornice along the slab, as the map has it. */
  grade?: PlotGrade | undefined;
}

/**
 * A made material's grade past plain (RFC 0051). The names are the sim's `GRADES`; this package
 * depends on nothing in the repo, so they're written out, and an unknown one draws nothing.
 */
type PlotGrade = "fine" | "masterwork";

/**
 * A grade's colors, the sim's `GRADE_LOOK` and `ROOF_GRADE_LOOK` (kept in step by
 * cards-copies.test.ts): the deep plinth band, the light catch, and the masterwork carving.
 */
const GRADE_BAND = "rgba(46, 28, 14, 0.3)";
const GRADE_CATCH = "rgba(255, 252, 240, 0.62)";
const GRADE_CARVED = "rgba(46, 28, 14, 0.5)";
const isGrade = (g: unknown): g is PlotGrade => g === "fine" || g === "masterwork";

/** How thick a wall between tiles is drawn, in tiles: the map's own share (`EDGE_THICKNESS`). */
const EDGE_THICKNESS = 0.22;

/**
 * Walls between tiles: a slab on each line, past each end by half its thickness so walls meet at
 * their corners. Only numbers kept to the box and checked colors go in. At most four per tile.
 */
function edgesSvg(
  edges: readonly PlotEdge[],
  inX: (x: number) => boolean,
  inY: (y: number) => boolean,
): string[] {
  const t = EDGE_THICKNESS;
  return edges.slice(0, 4096).flatMap((e) => {
    if (!inX(e.x) || !inY(e.y) || (e.side !== "n" && e.side !== "w")) return [];
    const x = n(e.x - t / 2);
    const y = n(e.y - t / 2);
    const w = e.side === "n" ? n(1 + t) : n(t);
    const h = e.side === "n" ? n(t) : n(1 + t);
    const fill = e.door ? DOOR_FRAME : e.pane ? PANE_FRAME : safeColor(e.fill);
    const out = [
      `<rect x="${n(x + 0.04)}" y="${n(y + 0.1)}" width="${w}" height="${h}" rx="0.05" fill="rgba(74, 52, 28, 0.2)"/>`,
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.05" fill="${fill}"/>`,
    ];
    if (e.door || e.pane) {
      const inner = e.door ? DOOR_PANEL : safeColor(e.fill);
      const ix = e.side === "n" ? n(x + w * 0.25) : n(x + 0.03);
      const iy = e.side === "n" ? n(y + 0.03) : n(y + h * 0.25);
      const iw = e.side === "n" ? n(w * 0.5) : n(Math.max(0.02, w - 0.06));
      const ih = e.side === "n" ? n(Math.max(0.02, h - 0.06)) : n(h * 0.5);
      out.push(
        `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="0.03" fill="${inner}"/>`,
      );
    }
    if (isGrade(e.grade) && !e.door) {
      // A plinth band along one long side and a light catch along the other, and for masterwork
      // a carved mark in the middle, so a graded wall reads in a photo as on the map.
      const band = n(t * 0.24);
      const plinth =
        e.side === "n"
          ? `<rect x="${x}" y="${n(y + h - band)}" width="${w}" height="${band}" fill="${GRADE_BAND}"/>`
          : `<rect x="${x}" y="${y}" width="${band}" height="${h}" fill="${GRADE_BAND}"/>`;
      const light =
        e.side === "n"
          ? `<rect x="${x}" y="${y}" width="${w}" height="${n(band * 0.6)}" fill="${GRADE_CATCH}"/>`
          : `<rect x="${n(x + w - band * 0.6)}" y="${y}" width="${n(band * 0.6)}" height="${h}" fill="${GRADE_CATCH}"/>`;
      out.push(plinth, light);
      if (e.grade === "masterwork") {
        out.push(
          `<circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(t * 0.28)}" fill="${GRADE_CARVED}"/>`,
        );
      }
    }
    return out;
  });
}

/** A door's frame and panel, the map's `DOOR_LOOK` (kept in step by cards-copies.test.ts). */
const DOOR_FRAME = "#b8834f";
const DOOR_PANEL = "#a8483a";
/** A window's frame between tiles. */
const PANE_FRAME = "#8a6a4a";

/** The plot as SVG markup, `px` pixels square. Our own markup only: numbers and checked colors. */
export function plotSvg(c: PlotCard, px: number): string {
  const side = (v: number) => Math.max(1, Math.min(32, Math.floor(v)));
  const S = side(c.size);
  // With slivers of the world around it the box is wider than the plot, which sits inside it.
  const cols = c.surround ? side(c.surround.cols) : S;
  const rows = c.surround ? side(c.surround.rows) : S;
  const at = c.surround ?? { x: 0, y: 0 };
  const parts = areaParts({
    cols,
    rows,
    ground: c.ground,
    tints: c.tints,
    blocks: c.blocks,
    edges: c.edges,
    crops: c.crops,
    hearths: [...(c.hearth ? [c.hearth] : []), ...(c.hearths ?? [])],
    pets: c.pet ? [c.pet] : [],
    figures: c.figures,
    floors: c.floors,
    roofs: c.roofs,
    floorPlan: c.floorPlan,
    ...(c.surround ? { subject: { x: at.x, y: at.y, w: S, h: S } } : {}),
    sky: c.sky,
    ink: c.ink,
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${cols} ${rows}" shape-rendering="geometricPrecision">${parts.join("")}</svg>`;
}

/** Most tiles an area may be across or down, and most figures and pets it draws. */
const MAX_SIDE = 64;
const MAX_FIGURES = 24;
const MAX_PETS = 24;
/** Most floors above the ground an area draws, and most flooring and blocks on each. */
const MAX_FLOORS = 4;
const MAX_FLOOR_TILES = MAX_SIDE * MAX_SIDE;

/** A floor's shadow, as the map draws it: how far it falls per floor, in tiles, and its color. */
const FLOOR_SHADOW = 0.22;
const FLOOR_SHADE = "rgba(43, 30, 18, 0.24)";
/** How dim what's under a floor plan shows where it has no flooring, as on the map. */
const UNDER_DIM = "rgba(43, 38, 32, 0.38)";
/** Most surface marks one wall draws. */
const MAX_WALL_MARKS = 32;
/** Most roofs an area draws, so a wide picture of the town stays cheap. */
const MAX_ROOFS = 12;
/** A roof (RFC 0041): how far its shadow falls, the light on its ridge, and its eaves' ink. */
const ROOF_SHADOW = 0.16;
const ROOF_LIGHT = "#fff7e6";
const ROOF_SHADE = "#3d3024";
const ROOF_EDGE = "rgba(61, 48, 36, 0.5)";
const ROOF_RIDGE = "rgba(255, 247, 230, 0.7)";
/** How faded a figure under flooring is drawn, as on the map. */
const UNDER_FLOORING_OPACITY = 0.5;

/**
 * A hearth's smoke, held still as a photo holds it: three puffs rising from the chimney at
 * (cx, cy), each bigger, fainter, and a little further along the breeze than the one under it.
 * Ovals as paths, like the leaves, so the hearth's shadow stays an area's only ellipse, and
 * plain fills with no filter, so a card stays cheap to draw. The same smoke the 3D view sends
 * up live; a still picture can only keep the moment of it (issue #80, decision 0305).
 */
function smokeSvg(cx: number, cy: number): string[] {
  return [
    oval(cx + 0.02, cy - 0.11, 0.07, 0.055, 0, "rgba(246, 244, 240, 0.55)"),
    oval(cx + 0.08, cy - 0.24, 0.09, 0.07, 0, "rgba(246, 244, 240, 0.42)"),
    oval(cx + 0.16, cy - 0.39, 0.12, 0.09, 0, "rgba(246, 244, 240, 0.3)"),
  ];
}

/**
 * An area's markup, in tile units from its top left: the ground and what lies on it, ponds, blocks,
 * decor and furniture, crops, hearths, the floors above the ground floor, pets, and figures, back
 * to front, with the weather and the light over all of it. Our own markup only.
 */
export function areaParts(a: PlotArea): string[] {
  const cols = Math.max(1, Math.min(MAX_SIDE, Math.floor(a.cols)));
  const rows = Math.max(1, Math.min(MAX_SIDE, Math.floor(a.rows)));
  const inX = (v: number) => Number.isFinite(v) && v >= 0 && v < cols;
  const inY = (v: number) => Number.isFinite(v) && v >= 0 && v < rows;
  const parts: string[] = [];
  const tufts: string[] = [];
  const flowers: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const g = a.ground[y * cols + x];
      if (!g) continue;
      // A hair wider than the tile, so neighbors share pixels and no seams show.
      parts.push(
        `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${safeColor(g.fill)}"/>`,
      );
      if (g.paving) {
        parts.push(...pavingSvg(g.paving, x, y));
        continue;
      }
      if (g.tuft !== undefined && Number.isFinite(g.tuft)) {
        const bx = x + g.tuft;
        const by = y + 0.72;
        tufts.push(
          `M${n(bx - 0.08)} ${n(by)}L${n(bx - 0.12)} ${n(by - 0.14)}M${n(bx)} ${n(by)}L${n(bx)} ${n(by - 0.2)}M${n(bx + 0.08)} ${n(by)}L${n(bx + 0.13)} ${n(by - 0.13)}`,
        );
      } else if (g.flower && Number.isFinite(g.flower.fx) && Number.isFinite(g.flower.fy)) {
        flowers.push(
          `<circle cx="${n(x + g.flower.fx)}" cy="${n(y + g.flower.fy)}" r="0.07" fill="${safeColor(g.flower.fill)}"/>`,
        );
      } else if (g.leaf) {
        const leaf = leafPath(x + g.leaf.fx, y + g.leaf.fy, g.leaf.turn);
        if (leaf) flowers.push(`<path d="${leaf}" fill="${safeColor(g.leaf.fill)}"/>`);
      }
    }
  }
  if (tufts.length) {
    parts.push(
      `<path d="${tufts.join("")}" stroke="${safeColor(a.ink.tuft)}" stroke-width="0.045" stroke-linecap="round" fill="none"/>`,
    );
  }
  parts.push(...flowers);
  for (const t of (a.tints ?? []).slice(0, 64)) {
    if (![t.x, t.y, t.w, t.h].every(Number.isFinite) || t.w <= 0 || t.h <= 0) continue;
    parts.push(
      `<rect x="${n(t.x)}" y="${n(t.y)}" width="${n(t.w)}" height="${n(t.h)}" fill="${safeColor(t.fill)}"/>`,
    );
  }

  // Ponds (RFC 0023) lie flat in the ground, under everything standing.
  const ponds = new Set(a.blocks.filter((b) => b.water).map((b) => `${b.x},${b.y}`));
  for (const b of a.blocks) {
    if (!b.water || !inX(b.x) || !inY(b.y)) continue;
    const at = (dx: number, dy: number) => ponds.has(`${b.x + dx},${b.y + dy}`);
    parts.push(
      ...pondSvg(b, safeColor(b.fill), a.ink.pond ?? POND_INK, {
        n: !at(0, -1),
        e: !at(1, 0),
        s: !at(0, 1),
        w: !at(-1, 0),
      }),
    );
  }

  parts.push(...blocksSvg(a.blocks, inX, inY));
  parts.push(...edgesSvg(a.edges ?? [], inX, inY));

  // What's growing, over its planter.
  for (const crop of a.crops ?? []) {
    if (inX(crop.x) && inY(crop.y)) parts.push(...cropSvg(crop));
  }

  // Hearths: a little house with a door, a clay roof, a chimney, and its smoke.
  for (const h of (a.hearths ?? []).slice(0, 64)) {
    if (!inX(h.x) || !inY(h.y)) continue;
    const sx = h.x + 0.5;
    const sy = h.y + 0.5;
    const half = 0.5;
    parts.push(
      `<ellipse cx="${n(sx)}" cy="${n(sy + half * 0.62)}" rx="${n(half * 0.62)}" ry="${n(half * 0.16)}" fill="rgba(74, 52, 28, 0.2)"/>`,
      `<rect x="${n(sx - half * 0.52)}" y="${n(sy - half * 0.2)}" width="${n(half * 1.04)}" height="${n(half * 0.78)}" fill="${safeColor(a.ink.walls)}"/>`,
      `<rect x="${n(sx - half * 0.14)}" y="${n(sy + half * 0.12)}" width="${n(half * 0.28)}" height="${n(half * 0.46)}" rx="0.04" fill="${safeColor(a.ink.door)}"/>`,
      // The chimney stands on the roof's right slope; the roof drawn after it covers its foot.
      `<rect x="${n(sx + half * 0.26)}" y="${n(sy - half * 0.72)}" width="${n(half * 0.16)}" height="${n(half * 0.42)}" fill="#8a7f70"/>`,
      `<path d="M${n(sx - half * 0.72)} ${n(sy - half * 0.12)}L${n(sx)} ${n(sy - half * 0.78)}L${n(sx + half * 0.72)} ${n(sy - half * 0.12)}z" fill="${safeColor(a.ink.roof)}"/>`,
      ...smokeSvg(sx + half * 0.34, sy - half * 0.72),
    );
  }
  parts.push(...floorsSvg(a, cols, rows, inX, inY));
  for (const roof of (a.roofs ?? []).slice(0, MAX_ROOFS)) parts.push(...roofSvg(roof, inX, inY));
  // A ring on the ground marks who the picture is about: under the pets and figures, over the rest.
  if (a.ring && Number.isFinite(a.ring.x) && Number.isFinite(a.ring.y)) {
    parts.push(
      `<ellipse cx="${n(a.ring.x)}" cy="${n(a.ring.y)}" rx="0.46" ry="0.17" fill="none" stroke="#ffffff" stroke-width="0.07" stroke-opacity="0.9"/>`,
    );
  }
  for (const pet of (a.pets ?? []).slice(0, MAX_PETS)) parts.push(...petSvg(pet, cols, rows));
  // Figures back to front, so someone further south stands in front.
  const figures = (a.figures ?? [])
    .slice(0, MAX_FIGURES)
    .filter((f) => inX(f.x) && Number.isFinite(f.y) && f.y > 0 && f.y <= rows + 1)
    .sort((p, q) => p.y - q.y);
  figures.forEach((f, i) => {
    parts.push(...figureSvg(f, `f${i}`));
  });
  parts.push(...surroundWash(a, cols, rows));
  if (a.sky) parts.push(...skyParts(a.sky, a.hearths ?? [], cols, rows));
  return parts;
}

/** How far the paper wash takes the world outside the subject back, at noon. */
const OUTSIDE_WASH_ALPHA = 0.52;

/**
 * How much of that wash a moment gets: all of it by day, none at midnight. The wash is paper, and
 * it goes under the night, which is a multiply: a bright warm band multiplied down stays light
 * while the subject beside it goes muddy, so at night the picture reads as a dark rectangle
 * stamped on a pale field, which is the fade backwards. Fading the wash out as the light goes
 * keeps the subject the brightest thing in the frame at every hour, and leaves every daylight
 * photo exactly as it was.
 */
function washAlpha(sky: Sky | undefined): number {
  const night = sky ? Math.min(1, Math.max(0, sky.night)) : 0;
  return OUTSIDE_WASH_ALPHA * (1 - night);
}

/**
 * The band outside the subject, washed back with paper: four rects, any of them empty where the
 * subject reaches that edge. It goes over everything standing in the area and under the sky, so
 * the night and the weather still fall on the whole picture evenly (issue #80).
 */
function surroundWash(a: PlotArea, cols: number, rows: number): string[] {
  const s = a.subject;
  if (!s) return [];
  const alpha = washAlpha(a.sky);
  if (alpha <= 0.01) return [];
  const wash = `rgba(255, 250, 240, ${n(alpha)})`;
  const x = Math.max(0, Math.min(cols, s.x));
  const y = Math.max(0, Math.min(rows, s.y));
  const right = Math.max(x, Math.min(cols, s.x + s.w));
  const bottom = Math.max(y, Math.min(rows, s.y + s.h));
  const band = (bx: number, by: number, w: number, h: number) =>
    w > 0 && h > 0
      ? [`<rect x="${n(bx)}" y="${n(by)}" width="${n(w)}" height="${n(h)}" fill="${wash}"/>`]
      : [];
  return [
    ...band(0, 0, cols, y),
    ...band(0, bottom, cols, rows - bottom),
    ...band(0, y, x, bottom - y),
    ...band(right, y, cols - right, bottom - y),
  ];
}

/**
 * Blocks standing on one floor: a ground shadow, the block and its surface's marks, a bottom shade,
 * and a top highlight, as in the world, with decor and furniture as themselves. Fences and low walls join their
 * neighbors on the same floor. Ponds are drawn flat with the ground, so they're left out here.
 */
function blocksSvg(
  blocks: readonly PlotBlock[],
  inX: (v: number) => boolean,
  inY: (v: number) => boolean,
): string[] {
  const parts: string[] = [];
  const fences = new Set(blocks.filter((b) => b.decor === "fence").map((b) => `${b.x},${b.y}`));
  const walls = new Set(
    blocks.filter((b) => b.furniture === "stone_wall").map((b) => `${b.x},${b.y}`),
  );
  for (const b of blocks) {
    if (b.water || !inX(b.x) || !inY(b.y)) continue;
    if (b.furniture && (PLOT_FURNITURE as readonly string[]).includes(b.furniture)) {
      const at = (dx: number, dy: number) => walls.has(`${b.x + dx},${b.y + dy}`);
      parts.push(
        ...furnitureSvg(b.furniture, b.x, b.y, safeColor(b.fill), {
          n: at(0, -1),
          e: at(1, 0),
          s: at(0, 1),
          w: at(-1, 0),
        }),
      );
      continue;
    }
    if (b.decor && (PLOT_DECOR as readonly string[]).includes(b.decor)) {
      const at = (dx: number, dy: number) => fences.has(`${b.x + dx},${b.y + dy}`);
      parts.push(
        ...decorSvg(b.decor, b.x, b.y, safeColor(b.fill), {
          n: at(0, -1),
          e: at(1, 0),
          s: at(0, 1),
          w: at(-1, 0),
        }),
      );
      continue;
    }
    const left = b.x + 0.05;
    const top = b.y + 0.05;
    const size = 0.9;
    const r = 0.14;
    const lip = 0.16;
    parts.push(
      `<rect x="${n(left + 0.03)}" y="${n(top + lip * 0.6)}" width="${size}" height="${size}" rx="${r}" fill="rgba(74, 52, 28, 0.2)"/>`,
      `<rect x="${n(left)}" y="${n(top)}" width="${size}" height="${size}" rx="${r}" fill="${safeColor(b.fill)}"/>`,
    );
    for (const m of (b.marks ?? []).slice(0, MAX_WALL_MARKS))
      parts.push(...markSvg(m, left, top, size));
    parts.push(
      `<path d="M${n(left)} ${n(top + size - lip)}h${size}v${n(lip - r)}a${r} ${r} 0 0 1 -${r} ${r}h-${n(size - 2 * r)}a${r} ${r} 0 0 1 -${r} -${r}z" fill="rgba(70, 40, 18, 0.22)"/>`,
      `<rect x="${n(left + r * 0.5)}" y="${n(top + 0.05)}" width="${n(size - r)}" height="0.09" rx="0.04" fill="${b.glass ? "rgba(255, 255, 255, 0.6)" : "rgba(255, 250, 235, 0.32)"}"/>`,
    );
  }
  return parts;
}

/**
 * The floors above the ground floor (RFC 0028), as the map draws them: each over the ones under
 * it, from the ground up, its flooring and blocks casting a shadow that falls further the higher it
 * is. A floor plan first dims every tile where its top floor has no flooring, so what's below shows
 * through.
 */
function floorsSvg(
  a: PlotArea,
  cols: number,
  rows: number,
  inX: (v: number) => boolean,
  inY: (v: number) => boolean,
): string[] {
  const floors = (a.floors ?? []).slice(0, MAX_FLOORS).map((s) => ({
    flooring: (s.flooring ?? []).slice(0, MAX_FLOOR_TILES).filter((f) => inX(f.x) && inY(f.y)),
    blocks: (s.blocks ?? []).slice(0, MAX_FLOOR_TILES),
  }));
  const parts: string[] = [];
  const top = floors.at(-1);
  if (a.floorPlan && top) {
    const floored = new Set(top.flooring.map((f) => `${f.x},${f.y}`));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (floored.has(`${x},${y}`)) continue;
        parts.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${UNDER_DIM}"/>`);
      }
    }
  }
  floors.forEach((s, i) => {
    const drop = FLOOR_SHADOW * (i + 1);
    const tiles = new Set<string>();
    for (const t of [...s.flooring, ...s.blocks.filter((b) => !b.water)]) {
      if (inX(t.x) && inY(t.y)) tiles.add(`${t.x},${t.y}`);
    }
    for (const key of tiles) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      parts.push(
        `<rect x="${n(x + drop)}" y="${n(y + drop)}" width="1" height="1" fill="${FLOOR_SHADE}"/>`,
      );
    }
    for (const f of s.flooring) parts.push(...pavingSvg(f.paving, f.x, f.y));
    parts.push(...blocksSvg(s.blocks, inX, inY));
  });
  return parts;
}

/** A roof tile's four corner heights, each kept to 0 to 1, whatever the spec carried. */
const corners = (h: number[]): [number, number, number, number] =>
  [0, 1, 2, 3].map((i) =>
    Math.max(0, Math.min(1, Number.isFinite(h[i]) ? (h[i] as number) : 0)),
  ) as [number, number, number, number];

/**
 * A home's roof (RFC 0041), as the map draws it: its shadow on everything below, then a tile at a
 * time lit by how high its corners stand, an ink line round the eaves, and a pale line along the
 * ridge, which is what names a gable, a hip or a pitched roof at a glance.
 */
function roofSvg(
  roof: PlotRoofing,
  inX: (v: number) => boolean,
  inY: (v: number) => boolean,
): string[] {
  // The whole roof decides its shape; the box only decides what is drawn. A neighbour's roof
  // that runs off the edge of the picture keeps its real ridge and its real eaves, instead of
  // growing a pale ridge along the highest tile that happens to be visible and an ink line down
  // the cut.
  const whole = roof.tiles.slice(0, MAX_FLOOR_TILES);
  const tiles = whole.filter((t) => inX(t.x) && inY(t.y));
  if (tiles.length === 0) return [];
  const fill = safeColor(roof.fill);
  const covered = new Set(whole.map((t) => `${t.x},${t.y}`));
  const on = (x: number, y: number) => covered.has(`${x},${y}`);
  const parts: string[] = [];
  for (const t of tiles) {
    parts.push(
      `<rect x="${n(t.x + ROOF_SHADOW)}" y="${n(t.y + ROOF_SHADOW)}" width="1.02" height="1.02" fill="${FLOOR_SHADE}"/>`,
    );
  }
  for (const t of tiles) {
    const high = corners(t.h).reduce((sum, h) => sum + h, 0) / 4;
    parts.push(
      `<rect x="${t.x}" y="${t.y}" width="1.02" height="1.02" fill="${fill}"/>`,
      // The eaves sit in shadow and the ridge catches the light, as the map shades them.
      `<rect x="${t.x}" y="${t.y}" width="1.02" height="1.02" fill="${high >= 0.5 ? ROOF_LIGHT : ROOF_SHADE}" fill-opacity="${n(Math.abs(high - 0.5) * 0.5)}"/>`,
    );
  }
  // The ridge is the pale line where the roof is at its highest, and only where it falls away
  // across the edge, so the flat top of a gable is outlined rather than gridded into its tiles.
  const top = Math.max(...whole.flatMap((t) => corners(t.h)));
  const heights = new Map(whole.map((t) => [`${t.x},${t.y}`, corners(t.h)] as const));
  const falls = (x: number, y: number) => {
    const h = heights.get(`${x},${y}`);
    return h === undefined || h.some((k) => k < top);
  };
  const eaves: string[] = [];
  const ridges: string[] = [];
  for (const t of tiles) {
    const [nw, ne, se, sw] = corners(t.h);
    const line = (a: string, b: string, which: string[]) => which.push(`M${a}L${b}`);
    const NW = `${t.x} ${t.y}`;
    const NE = `${t.x + 1} ${t.y}`;
    const SE = `${t.x + 1} ${t.y + 1}`;
    const SW = `${t.x} ${t.y + 1}`;
    if (!on(t.x, t.y - 1)) line(NW, NE, eaves);
    if (!on(t.x, t.y + 1)) line(SW, SE, eaves);
    if (!on(t.x - 1, t.y)) line(NW, SW, eaves);
    if (!on(t.x + 1, t.y)) line(NE, SE, eaves);
    if (nw >= top && ne >= top && falls(t.x, t.y - 1)) line(NW, NE, ridges);
    if (sw >= top && se >= top && falls(t.x, t.y + 1)) line(SW, SE, ridges);
    if (nw >= top && sw >= top && falls(t.x - 1, t.y)) line(NW, SW, ridges);
    if (ne >= top && se >= top && falls(t.x + 1, t.y)) line(NE, SE, ridges);
  }
  if (eaves.length > 0) {
    // A graded covering (RFC 0051): a deep band under the eaves' ink, as the map draws it.
    if (isGrade(roof.grade)) {
      parts.push(
        `<path d="${eaves.join("")}" fill="none" stroke="${GRADE_BAND}" stroke-width="0.16"/>`,
      );
    }
    parts.push(
      `<path d="${eaves.join("")}" fill="none" stroke="${ROOF_EDGE}" stroke-width="0.05"/>`,
    );
  }
  if (roof.grade === "masterwork" && !roof.top) {
    // A masterwork covering's carved diamond on its first highest tile.
    const peak = whole.find((t) => Math.max(...corners(t.h)) >= top);
    if (peak && inX(peak.x) && inY(peak.y)) {
      const cx = peak.x + 0.5;
      const cy = peak.y + 0.5;
      parts.push(
        `<path d="M${n(cx)} ${n(cy - 0.22)}L${n(cx + 0.22)} ${n(cy)}L${n(cx)} ${n(cy + 0.22)}L${n(cx - 0.22)} ${n(cy)}Z" fill="none" stroke="${GRADE_CARVED}" stroke-width="0.07"/>`,
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="0.06" fill="${GRADE_CARVED}"/>`,
      );
    }
  }
  if (ridges.length > 0) {
    parts.push(
      `<path d="${ridges.join("")}" fill="none" stroke="${ROOF_RIDGE}" stroke-width="0.06"/>`,
    );
  }
  if (roof.top && inX(roof.top.x) && inY(roof.top.y)) {
    parts.push(...roofTopSvg(roof.top));
  }
  return parts;
}

/** The ink and the paper a ridge's mark is drawn in, as the map draws it. */
const TOP_INK = "#3d3024";
const TOP_PAPER = "#fff7e6";

/**
 * What stands on a roof's ridge, from above and in the middle of its tile: a weather vane as a
 * cross with its pointer, a flag as a pole with its cloth out to the east, a bird's nest as a ring
 * of twigs. The same shapes `paintRoofTop` draws on the map and on a thumbnail.
 */
function roofTopSvg(top: NonNullable<PlotRoofing["top"]>): string[] {
  const cx = top.x + 0.5;
  const cy = top.y + 0.5;
  const w = 0.07;
  if (top.kind === "nest") {
    return [
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="0.2" fill="none" stroke="${TOP_INK}" stroke-width="${n(w * 1.6)}"/>`,
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="0.09" fill="${TOP_PAPER}"/>`,
    ];
  }
  const parts: string[] =
    top.kind === "vane"
      ? [
          `<path d="M${n(cx - 0.22)} ${n(cy)}L${n(cx + 0.22)} ${n(cy)}M${n(cx)} ${n(cy - 0.22)}L${n(cx)} ${n(cy + 0.22)}" fill="none" stroke="${TOP_INK}" stroke-width="${n(w)}" stroke-linecap="round"/>`,
          `<path d="M${n(cx + 0.3)} ${n(cy)}L${n(cx + 0.14)} ${n(cy - 0.12)}L${n(cx + 0.14)} ${n(cy + 0.12)}z" fill="${TOP_INK}"/>`,
        ]
      : [
          `<path d="M${n(cx - 0.12)} ${n(cy - 0.18)}L${n(cx - 0.12)} ${n(cy + 0.18)}" fill="none" stroke="${TOP_INK}" stroke-width="${n(w)}" stroke-linecap="round"/>`,
          `<path d="M${n(cx - 0.1)} ${n(cy - 0.16)}L${n(cx + 0.26)} ${n(cy - 0.04)}L${n(cx - 0.1)} ${n(cy + 0.08)}z" fill="${TOP_INK}"/>`,
        ];
  parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(w * 0.9)}" fill="${TOP_PAPER}"/>`);
  return parts;
}

/**
 * A resident's figure with its feet at (x, y): a soft shadow on the ground, then the figure at a
 * tile's height, as the map stands it (100 of the drawing's units to a tile).
 */
function figureSvg(f: PlacedFigure, id: string): string[] {
  if (!drawingBox(f.drawing)) return [];
  const body = drawingSvg(f.drawing, id);
  if (!body) return [];
  // Never hidden: someone under flooring is drawn faded (RFC 0028).
  const faded = f.faded ? ` opacity="${UNDER_FLOORING_OPACITY}"` : "";
  return [
    `<ellipse cx="${n(f.x)}" cy="${n(f.y)}" rx="0.27" ry="0.085" fill="rgba(60, 40, 20, 0.22)"/>`,
    `<g transform="translate(${n(f.x)} ${n(f.y)}) scale(0.01)"${faded}>${body}</g>`,
  ];
}

/**
 * A tile of pond as `packages/client/src/render.ts` draws it, held still for a photo: the water, a
 * shade along each bank, the stone rim there with three pebbles a side, a lily pad when it has one,
 * and two glints.
 */
function pondSvg(
  b: PlotBlock,
  water: string,
  ink: PlotPondInk,
  open: { n: boolean; e: boolean; s: boolean; w: boolean },
): string[] {
  const { x, y } = b;
  const band = 0.28;
  const rim = 0.13;
  const out = [`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${water}"/>`];
  const sides = [
    [open.n, x, y, 1, band, x, y, 1, rim],
    [open.s, x, y + 1 - band, 1, band, x, y + 1 - rim, 1, rim],
    [open.w, x, y, band, 1, x, y, rim, 1],
    [open.e, x + 1 - band, y, band, 1, x + 1 - rim, y, rim, 1],
  ] as const;
  for (const [on, sx, sy, w, h] of sides) {
    if (on) {
      out.push(
        `<rect x="${n(sx)}" y="${n(sy)}" width="${w}" height="${h}" fill="${safeColor(ink.shade)}"/>`,
      );
    }
  }
  for (const [on, , , , , sx, sy, w, h] of sides) {
    if (!on) continue;
    out.push(
      `<rect x="${n(sx)}" y="${n(sy)}" width="${w}" height="${h}" fill="${safeColor(ink.stone)}"/>`,
    );
    for (const t of [0.22, 0.58, 0.86]) {
      const px = w > h ? sx + w * t : sx + w / 2;
      const py = w > h ? sy + h / 2 : sy + h * t;
      out.push(`<circle cx="${n(px)}" cy="${n(py)}" r="0.04" fill="${safeColor(ink.pebble)}"/>`);
    }
  }
  if (b.lily) {
    out.push(
      `<path d="M${n(x + 0.42)} ${n(y + 0.56)}l0.12 -0.05a0.13 0.13 0 1 0 0 0.1z" fill="${safeColor(ink.lily)}"/>`,
    );
  }
  out.push(
    `<path d="M${n(x + 0.26)} ${n(y + 0.4)}H${n(x + 0.44)}M${n(x + 0.54)} ${n(y + 0.7)}H${n(x + 0.66)}" stroke="${safeColor(ink.glint)}" stroke-opacity="0.6" stroke-width="0.045" stroke-linecap="round"/>`,
  );
  return out;
}

/**
 * A fallen leaf around (cx, cy), lying `turn` radians from east: two curves from tip to tip, as
 * `packages/client/src/render.ts` draws it. Undefined for anything that isn't a finite number.
 */
function leafPath(cx: number, cy: number, turn: number): string | undefined {
  if (![cx, cy, turn].every(Number.isFinite)) return undefined;
  const dx = Math.cos(turn);
  const dy = Math.sin(turn);
  const long = 0.14;
  const wide = 0.13;
  const tip = (k: number) => `${n(cx + dx * long * k)} ${n(cy + dy * long * k)}`;
  const side = (k: number) => `${n(cx - dy * wide * k)} ${n(cy + dx * wide * k)}`;
  return `M${tip(1)}Q${side(1)} ${tip(-1)}Q${side(-1)} ${tip(1)}`;
}

/** The side of a pet picture's box, in its own units, as the sim draws it. */
export const PET_BOX = 48;
/** Where a pet's feet are in its box, from the top, as the sim has it. */
export const PET_FEET = 42.5;
const PET_TAGS = new Set(["path", "circle", "ellipse"]);
const NUMERIC = new Set(["cx", "cy", "r", "rx", "ry", "stroke-width", "opacity"]);
const WORDS: Record<string, ReadonlySet<string>> = {
  "stroke-linejoin": new Set(["round", "miter", "bevel"]),
  "stroke-linecap": new Set(["round", "butt", "square"]),
};
/** A path made only of commands and numbers: nothing that could close the attribute. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]{1,1500}$/;

/** One attribute of a pet's shape as markup, or "" when it isn't one we draw or doesn't check out. */
function petAttr(name: string, value: string | number): string {
  if (NUMERIC.has(name)) {
    const v = Number(value);
    return typeof value === "number" && Number.isFinite(v) && Math.abs(v) < 1000
      ? ` ${name}="${n(v)}"`
      : "";
  }
  if (name === "fill" || name === "stroke") {
    return value === "none" ? ` ${name}="none"` : ` ${name}="${safeColor(String(value))}"`;
  }
  if (name === "d") return PATH_DATA.test(String(value)) ? ` d="${String(value)}"` : "";
  const words = WORDS[name];
  return words?.has(String(value)) ? ` ${name}="${String(value)}"` : "";
}

/** A pet on the plot, its picture scaled into its box and flipped to face left when it does. */
export function petSvg(p: PlotPet, cols: number, rows = cols): string[] {
  const { x, y, size } = p;
  const ok = [x, y, size].every(Number.isFinite) && size > 0 && size <= 4;
  if (!ok || x < -size || y < -size || x > cols || y > rows || !Array.isArray(p.shapes)) {
    return [];
  }
  const k = size / PET_BOX;
  const place = p.flip
    ? `translate(${n(x + size)} ${n(y)}) scale(${n(-k)} ${n(k)})`
    : `translate(${n(x)} ${n(y)}) scale(${n(k)})`;
  const shapes = p.shapes.slice(0, 80).flatMap((s) => {
    if (!PET_TAGS.has(s.tag) || !s.attrs || typeof s.attrs !== "object") return [];
    const attrs = Object.entries(s.attrs)
      .map(([name, value]) => petAttr(name, value))
      .join("");
    return [`<${s.tag}${attrs}/>`];
  });
  return [`<g transform="${place}">${shapes.join("")}</g>`];
}

const WOOD_DARK = "#6e4a2c";
const WOOD = "#9a6b43";
const EDGE = "rgba(70, 40, 18, 0.5)";
const STRAW = "#e8c878";
const STRAW_DEEP = "#c49a4c";
const BURLAP = "#d9bf8f";
/** The water in a bird bath, the pond's own blue (decision 0311). */
const POND_WATER = "#5fa9d0";
/**
 * Halloween's colors (RFC 0022), as `packages/ui/src/looks.ts` has them. Bunting's bats are its
 * `fill`.
 */
const PENNANT = "#e8862f";
const IRON_RIM = "#56545e";
const BREW = "#8fd16a";
const BREW_LIGHT = "#c8f0a8";
const STAND = "#c4661c";
const CANDY = ["#f08a3c", "#a98bd8", "#ea8a9d", "#7fd1b0", "#f2b84b"] as const;
/**
 * Winter's colors (RFC 0017), as `WINTER_HEX` in `packages/ui/src/looks.ts` has them. Each decor's
 * main color is its `fill`: the snowman's snow, the string's warm bulb, the fir's needles, the
 * sled's slats.
 */
const SNOW_SHADE = "#c4d2e2";
const SNOW_EDGE = "rgba(84, 104, 128, 0.7)";
const COAL = "#2f2c33";
const CARROT = "#ec7a2c";
const SCARF = "#c8344a";
const SNOW_HAT = "#3a3946";
const SNOW = "#f4f7fb";
const WIRE = "#3f5a3c";
const BULBS = ["#f2564c", "#5ec0ea", "#7fd17a", "#c38df0"] as const;
const NEEDLES_LIGHT = "#4a8f5c";
const POT = "#c8674a";
const POT_RIM = "#a9533a";
const STAR = "#f2c94c";
const RUNNER = "#4a4542";
const SLAT_SIDE = "#9e3428";
const ROPE = "#e3cf9c";
/**
 * Thanksgiving's colors (RFC 0034), as `THANKSGIVING_HEX` in `packages/ui/src/looks.ts` has them.
 * The cornucopia's wicker and the garland's first leaf are each one's `fill`.
 */
const WEAVE = "#9c6b3a";
const APPLE = "#d2463a";
const GOURD = "#e8862f";
const GRAPES = "#7b4f9c";
const TWINE = "#7a5a3a";
const LEAVES = ["#e0a33a", "#a8382c", "#d47a2a", "#b85a2a"] as const;
/**
 * Hanukkah's colors (RFC 0034), as `HANUKKAH_HEX` in `packages/ui/src/looks.ts` has them. The
 * menorah's brass and the dreidel's blue are each one's `fill`. Plot photos are daylight, so the
 * candles stand unlit.
 */
const BRASS_DARK = "#9c7a2e";
const CANDLE = "#f4f1e8";
const DREIDEL_LIGHT = "#6f97d0";
/** A maple leaf, point up, as `LEAF_POINTS` in `packages/ui/src/looks.ts`: half its width is 1. */
const LEAF_POINTS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0.25, -0.45],
  [0.75, -0.65],
  [0.55, -0.1],
  [1, 0.1],
  [0.45, 0.35],
  [0.5, 0.8],
  [0, 0.5],
  [-0.5, 0.8],
  [-0.45, 0.35],
  [-1, 0.1],
  [-0.55, -0.1],
  [-0.75, -0.65],
  [-0.25, -0.45],
];
/**
 * A bat with its wings spread, as `BAT_POINTS` in `packages/ui/src/looks.ts`: half its span is 1.
 */
const BAT_POINTS: readonly (readonly [number, number])[] = [
  [0, -0.2],
  [-0.12, -0.42],
  [-0.2, -0.18],
  [-0.55, -0.36],
  [-1, -0.08],
  [-0.78, 0.06],
  [-0.66, 0],
  [-0.52, 0.2],
  [-0.36, 0.1],
  [-0.2, 0.32],
  [0, 0.18],
  [0.2, 0.32],
  [0.36, 0.1],
  [0.52, 0.2],
  [0.66, 0],
  [0.78, 0.06],
  [1, -0.08],
  [0.55, -0.36],
  [0.2, -0.18],
  [0.12, -0.42],
];

/**
 * One decor block on tile (x, y), following `packages/client/src/render.ts`: a paper lantern on a
 * hook, a picture on an easel, a fence post with rails to the fences beside it, a garden bench, a
 * hay bale, a scarecrow, bat bunting, a cauldron, a candy bowl, a snowman, a string of lights, a
 * little fir, or a sled. Only numbers and checked colors go in. No ellipses, so the tests can tell
 * the hearth's shadow apart.
 */
function decorSvg(
  kind: PlotDecor,
  x: number,
  y: number,
  fill: string,
  joins: { n: boolean; e: boolean; s: boolean; w: boolean },
): string[] {
  const X = (f: number) => n(x + f);
  const Y = (f: number) => n(y + f);
  const stroke = `stroke="${EDGE}" stroke-width="0.035" stroke-linejoin="round"`;
  const shade = `<rect x="${X(0.16)}" y="${Y(0.86)}" width="0.68" height="0.1" rx="0.05" fill="rgba(74, 52, 28, 0.2)"/>`;
  if (kind === "lantern") {
    return [
      shade,
      `<path d="M${X(0.33)} ${Y(0.92)}V${Y(0.16)}Q${X(0.34)} ${Y(0.06)} ${X(0.58)} ${Y(0.08)}Q${X(0.66)} ${Y(0.1)} ${X(0.66)} ${Y(0.2)}" fill="none" stroke="${WOOD_DARK}" stroke-width="0.065" stroke-linecap="round"/>`,
      `<circle cx="${X(0.66)}" cy="${Y(0.44)}" r="0.24" fill="rgba(242, 181, 68, 0.28)"/>`,
      `<rect x="${X(0.48)}" y="${Y(0.24)}" width="0.36" height="0.4" rx="0.17" fill="${fill}" ${stroke}/>`,
      `<rect x="${X(0.56)}" y="${Y(0.2)}" width="0.2" height="0.06" rx="0.02" fill="${WOOD_DARK}"/>`,
      `<rect x="${X(0.56)}" y="${Y(0.62)}" width="0.2" height="0.06" rx="0.02" fill="${WOOD_DARK}"/>`,
    ];
  }
  if (kind === "frame") {
    return [
      shade,
      `<path d="M${X(0.22)} ${Y(0.92)}L${X(0.42)} ${Y(0.1)}M${X(0.78)} ${Y(0.92)}L${X(0.58)} ${Y(0.1)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
      `<rect x="${X(0.15)}" y="${Y(0.14)}" width="0.7" height="0.52" rx="0.04" fill="${fill}" ${stroke}/>`,
      `<rect x="${X(0.22)}" y="${Y(0.21)}" width="0.56" height="0.38" fill="#cfe6ee"/>`,
      `<circle cx="${X(0.62)}" cy="${Y(0.32)}" r="0.06" fill="#f2b84b"/>`,
      `<path d="M${X(0.22)} ${Y(0.59)}V${Y(0.46)}Q${X(0.4)} ${Y(0.36)} ${X(0.56)} ${Y(0.48)}Q${X(0.68)} ${Y(0.42)} ${X(0.78)} ${Y(0.46)}V${Y(0.59)}z" fill="#5e7f45"/>`,
      `<rect x="${X(0.13)}" y="${Y(0.65)}" width="0.74" height="0.06" fill="${WOOD_DARK}"/>`,
    ];
  }
  if (kind === "fence") {
    const rails: string[] = [];
    for (const [on, from, to] of [
      [joins.w, 0, 0.5],
      [joins.e, 0.5, 1],
    ] as const) {
      if (!on) continue;
      for (const fy of [0.34, 0.62]) {
        rails.push(
          `<rect x="${X(from)}" y="${Y(fy)}" width="${to - from}" height="0.09" fill="${fill}" ${stroke}/>`,
        );
      }
    }
    if (joins.n) {
      rails.push(
        `<rect x="${X(0.43)}" y="${Y(0)}" width="0.14" height="0.2" fill="${fill}" ${stroke}/>`,
      );
    }
    if (joins.s) {
      rails.push(
        `<rect x="${X(0.43)}" y="${Y(0.82)}" width="0.14" height="0.18" fill="${fill}" ${stroke}/>`,
      );
    }
    return [
      ...rails,
      `<path d="M${X(0.39)} ${Y(0.92)}V${Y(0.24)}L${X(0.5)} ${Y(0.12)}L${X(0.61)} ${Y(0.24)}V${Y(0.92)}z" fill="${fill}" ${stroke}/>`,
    ];
  }
  if (kind === "hay_bale") {
    return [
      shade,
      `<rect x="${X(0.1)}" y="${Y(0.34)}" width="0.8" height="0.56" rx="0.1" fill="${fill}" ${stroke}/>`,
      `<rect x="${X(0.14)}" y="${Y(0.37)}" width="0.72" height="0.14" rx="0.06" fill="rgba(255, 250, 235, 0.4)"/>`,
      `<path d="M${X(0.33)} ${Y(0.35)}V${Y(0.89)}M${X(0.67)} ${Y(0.35)}V${Y(0.89)}" stroke="${WOOD_DARK}" stroke-width="0.035"/>`,
      `<path d="M${X(0.17)} ${Y(0.64)}h0.09M${X(0.43)} ${Y(0.74)}h0.12M${X(0.74)} ${Y(0.6)}h0.08" stroke="${EDGE}" stroke-width="0.03" stroke-linecap="round"/>`,
    ];
  }
  if (kind === "bat_bunting") {
    const at = (t: number) => ({ x: 0.12 + 0.76 * t, y: 0.26 + 0.52 * t * (1 - t) });
    const bat = (t: number) => {
      const p = at(t);
      const k = 0.135;
      const d = BAT_POINTS.map(
        ([bx, by], i) => `${i ? "L" : "M"}${X(p.x + bx * k)} ${Y(p.y + 0.07 + by * k)}`,
      );
      return `<path d="${d.join("")}z" fill="${fill}"/>`;
    };
    const pennant = (t: number) => {
      const p = at(t);
      return `<path d="M${X(p.x - 0.06)} ${Y(p.y)}H${X(p.x + 0.06)}L${X(p.x)} ${Y(p.y + 0.14)}z" fill="${PENNANT}"/>`;
    };
    return [
      shade,
      `<path d="M${X(0.12)} ${Y(0.92)}V${Y(0.22)}M${X(0.88)} ${Y(0.92)}V${Y(0.22)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
      `<path d="M${X(0.12)} ${Y(0.26)}Q${X(0.5)} ${Y(0.52)} ${X(0.88)} ${Y(0.26)}" fill="none" stroke="#5a4f60" stroke-width="0.02"/>`,
      pennant(0.35),
      pennant(0.65),
      bat(0.18),
      bat(0.5),
      bat(0.82),
    ];
  }
  if (kind === "cauldron") {
    return [
      shade,
      `<rect x="${X(0.26)}" y="${Y(0.78)}" width="0.08" height="0.14" fill="${fill}"/>`,
      `<rect x="${X(0.66)}" y="${Y(0.78)}" width="0.08" height="0.14" fill="${fill}"/>`,
      `<path d="M${X(0.16)} ${Y(0.42)}C${X(0.16)} ${Y(0.86)} ${X(0.84)} ${Y(0.86)} ${X(0.84)} ${Y(0.42)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.14)} ${Y(0.42)}a0.36 0.09 0 1 0 0.72 0a0.36 0.09 0 1 0 -0.72 0z" fill="${IRON_RIM}" ${stroke}/>`,
      `<path d="M${X(0.22)} ${Y(0.42)}a0.28 0.055 0 1 0 0.56 0a0.28 0.055 0 1 0 -0.56 0z" fill="${BREW}"/>`,
      `<circle cx="${X(0.42)}" cy="${Y(0.32)}" r="0.045" fill="${BREW_LIGHT}"/>`,
      `<circle cx="${X(0.57)}" cy="${Y(0.24)}" r="0.032" fill="${BREW_LIGHT}"/>`,
    ];
  }
  if (kind === "candy_bowl") {
    const sweets = (
      [
        [0.32, 0.44, 0],
        [0.67, 0.44, 1],
        [0.5, 0.37, 4],
        [0.42, 0.47, 3],
        [0.58, 0.47, 2],
      ] as const
    ).map(
      ([cx, cy, c]) =>
        `<circle cx="${X(cx)}" cy="${Y(cy)}" r="0.085" fill="${CANDY[c]}" ${stroke}/>`,
    );
    return [
      shade,
      `<path d="M${X(0.38)} ${Y(0.9)}H${X(0.62)}L${X(0.57)} ${Y(0.74)}H${X(0.43)}z" fill="${STAND}"/>`,
      ...sweets,
      `<path d="M${X(0.12)} ${Y(0.5)}H${X(0.88)}C${X(0.88)} ${Y(0.82)} ${X(0.12)} ${Y(0.82)} ${X(0.12)} ${Y(0.5)}z" fill="${fill}" ${stroke}/>`,
      `<rect x="${X(0.16)}" y="${Y(0.58)}" width="0.68" height="0.05" fill="${CANDY[1]}"/>`,
    ];
  }
  if (kind === "snowman") {
    const snow = `stroke="${SNOW_EDGE}" stroke-width="0.035"`;
    const ball = (cy: number, r: number) => [
      `<circle cx="${X(0.5)}" cy="${Y(cy)}" r="${r}" fill="${SNOW_SHADE}"/>`,
      `<circle cx="${X(0.5 - r * 0.2)}" cy="${Y(cy - r * 0.2)}" r="${n(r * 0.94)}" fill="${fill}"/>`,
      `<circle cx="${X(0.5)}" cy="${Y(cy)}" r="${r}" fill="none" ${snow}/>`,
    ];
    return [
      shade,
      `<path d="M${X(0.4)} ${Y(0.46)}L${X(0.14)} ${Y(0.3)}M${X(0.6)} ${Y(0.46)}L${X(0.86)} ${Y(0.3)}" stroke="${WOOD_DARK}" stroke-width="0.035" stroke-linecap="round"/>`,
      ...ball(0.74, 0.2),
      ...ball(0.47, 0.145),
      ...ball(0.25, 0.105),
      `<circle cx="${X(0.46)}" cy="${Y(0.235)}" r="0.018" fill="${COAL}"/>`,
      `<circle cx="${X(0.54)}" cy="${Y(0.235)}" r="0.018" fill="${COAL}"/>`,
      `<circle cx="${X(0.5)}" cy="${Y(0.44)}" r="0.02" fill="${COAL}"/>`,
      `<circle cx="${X(0.5)}" cy="${Y(0.51)}" r="0.02" fill="${COAL}"/>`,
      `<path d="M${X(0.5)} ${Y(0.255)}L${X(0.61)} ${Y(0.272)}L${X(0.5)} ${Y(0.29)}z" fill="${CARROT}"/>`,
      `<rect x="${X(0.37)}" y="${Y(0.335)}" width="0.26" height="0.06" rx="0.03" fill="${SCARF}" ${stroke}/>`,
      `<rect x="${X(0.54)}" y="${Y(0.36)}" width="0.06" height="0.13" rx="0.02" fill="${SCARF}" ${stroke}/>`,
      `<rect x="${X(0.37)}" y="${Y(0.14)}" width="0.26" height="0.035" rx="0.015" fill="${SNOW_HAT}"/>`,
      `<rect x="${X(0.425)}" y="${Y(0.03)}" width="0.15" height="0.12" rx="0.02" fill="${SNOW_HAT}"/>`,
    ];
  }
  if (kind === "string_lights") {
    const at = (t: number) => ({ x: 0.1 + 0.8 * t, y: 0.32 + 0.48 * t * (1 - t) + 0.07 });
    const bulbs = [0.12, 0.31, 0.5, 0.69, 0.88].map((t, i) => {
      const p = at(t);
      const color = i === 1 ? fill : (BULBS[i % BULBS.length] as string);
      return `<rect x="${X(p.x - 0.036)}" y="${Y(p.y - 0.052)}" width="0.072" height="0.104" rx="0.036" fill="${color}" ${stroke}/>`;
    });
    return [
      shade,
      `<path d="M${X(0.1)} ${Y(0.92)}V${Y(0.28)}M${X(0.9)} ${Y(0.92)}V${Y(0.28)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
      `<path d="M${X(0.1)} ${Y(0.32)}Q${X(0.5)} ${Y(0.56)} ${X(0.9)} ${Y(0.32)}" fill="none" stroke="${WIRE}" stroke-width="0.025"/>`,
      ...bulbs,
    ];
  }
  if (kind === "little_fir") {
    const tiers = (
      [
        [0.36, 0.7, 0.3],
        [0.2, 0.53, 0.23],
        [0.06, 0.35, 0.16],
      ] as const
    ).flatMap(([apex, base, half]) => [
      `<path d="M${X(0.5)} ${Y(apex)}L${X(0.5 + half)} ${Y(base)}Q${X(0.5)} ${Y(base + 0.05)} ${X(0.5 - half)} ${Y(base)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.5)} ${Y(apex)}L${X(0.5 - half * 0.75)} ${Y(base - 0.02)}L${X(0.5 - half * 0.45)} ${Y(base - 0.01)}z" fill="${NEEDLES_LIGHT}"/>`,
      `<rect x="${X(0.5 - half * 0.7 - 0.06)}" y="${Y(base - 0.022)}" width="0.12" height="0.044" rx="0.022" fill="${SNOW}"/>`,
      `<rect x="${X(0.5 + half * 0.65 - 0.07)}" y="${Y(base - 0.024)}" width="0.14" height="0.048" rx="0.024" fill="${SNOW}"/>`,
    ]);
    const star: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 0.07 : 0.03;
      star.push(`${i ? "L" : "M"}${X(0.5 + Math.cos(a) * r)} ${Y(0.07 + Math.sin(a) * r)}`);
    }
    return [
      shade,
      `<rect x="${X(0.465)}" y="${Y(0.64)}" width="0.07" height="0.1" fill="${WOOD_DARK}"/>`,
      ...tiers,
      `<path d="M${X(0.33)} ${Y(0.75)}H${X(0.67)}L${X(0.63)} ${Y(0.93)}H${X(0.37)}z" fill="${POT}" ${stroke}/>`,
      `<rect x="${X(0.3)}" y="${Y(0.7)}" width="0.4" height="0.07" rx="0.02" fill="${POT_RIM}" ${stroke}/>`,
      `<path d="${star.join("")}z" fill="${STAR}" ${stroke}/>`,
    ];
  }
  if (kind === "sled") {
    const runner = (dx: number, dy: number, color: string) =>
      `<path d="M${X(0.08 + dx)} ${Y(0.86 + dy)}H${X(0.74 + dx)}Q${X(0.92 + dx)} ${Y(0.86 + dy)} ${X(0.9 + dx)} ${Y(0.68 + dy)}M${X(0.18 + dx)} ${Y(0.86 + dy)}V${Y(0.72 + dy)}M${X(0.44 + dx)} ${Y(0.86 + dy)}V${Y(0.72 + dy)}M${X(0.68 + dx)} ${Y(0.86 + dy)}V${Y(0.72 + dy)}" fill="none" stroke="${color}" stroke-width="0.045" stroke-linecap="round"/>`;
    return [
      shade,
      runner(0.05, -0.07, "#6e6a66"),
      runner(0, 0, RUNNER),
      `<path d="M${X(0.1)} ${Y(0.66)}H${X(0.78)}V${Y(0.74)}H${X(0.1)}z" fill="${SLAT_SIDE}" ${stroke}/>`,
      `<path d="M${X(0.1)} ${Y(0.66)}L${X(0.17)} ${Y(0.58)}H${X(0.85)}L${X(0.78)} ${Y(0.66)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.88)} ${Y(0.62)}Q${X(1)} ${Y(0.6)} ${X(0.96)} ${Y(0.78)}" fill="none" stroke="${ROPE}" stroke-width="0.03" stroke-linecap="round"/>`,
    ];
  }
  if (kind === "cornucopia") {
    return [
      shade,
      `<path d="M${X(0.86)} ${Y(0.62)}C${X(0.86)} ${Y(0.86)} ${X(0.5)} ${Y(0.9)} ${X(0.2)} ${Y(0.62)}C${X(0.1)} ${Y(0.5)} ${X(0.08)} ${Y(0.36)} ${X(0.14)} ${Y(0.34)}C${X(0.2)} ${Y(0.34)} ${X(0.2)} ${Y(0.46)} ${X(0.3)} ${Y(0.44)}C${X(0.42)} ${Y(0.38)} ${X(0.54)} ${Y(0.36)} ${X(0.66)} ${Y(0.38)}C${X(0.8)} ${Y(0.4)} ${X(0.86)} ${Y(0.5)} ${X(0.86)} ${Y(0.62)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.34)} ${Y(0.42)}L${X(0.42)} ${Y(0.74)}M${X(0.46)} ${Y(0.42)}L${X(0.54)} ${Y(0.74)}M${X(0.58)} ${Y(0.42)}L${X(0.66)} ${Y(0.74)}" stroke="${WEAVE}" stroke-width="0.025"/>`,
      `<rect x="${X(0.6)}" y="${Y(0.43)}" width="0.26" height="0.38" rx="0.13" fill="${WEAVE}"/>`,
      `<circle cx="${X(0.71)}" cy="${Y(0.52)}" r="0.095" fill="${APPLE}" ${stroke}/>`,
      `<circle cx="${X(0.82)}" cy="${Y(0.67)}" r="0.09" fill="${GOURD}" ${stroke}/>`,
      `<circle cx="${X(0.66)}" cy="${Y(0.71)}" r="0.04" fill="${GRAPES}"/>`,
      `<circle cx="${X(0.73)}" cy="${Y(0.74)}" r="0.04" fill="${GRAPES}"/>`,
      `<circle cx="${X(0.69)}" cy="${Y(0.78)}" r="0.04" fill="${GRAPES}"/>`,
    ];
  }
  if (kind === "leaf_garland") {
    const at = (t: number) => ({ x: 0.12 + 0.76 * t, y: 0.26 + 0.52 * t * (1 - t) });
    const leaf = (t: number, i: number) => {
      const p = at(t);
      const k = 0.095;
      const d = LEAF_POINTS.map(
        ([lx, ly], j) => `${j ? "L" : "M"}${X(p.x + lx * k)} ${Y(p.y + 0.08 + ly * k)}`,
      );
      const color = i === 0 ? fill : (LEAVES[(i - 1) % LEAVES.length] as string);
      return `<path d="${d.join("")}z" fill="${color}"/>`;
    };
    return [
      shade,
      `<path d="M${X(0.12)} ${Y(0.92)}V${Y(0.22)}M${X(0.88)} ${Y(0.92)}V${Y(0.22)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
      `<path d="M${X(0.12)} ${Y(0.26)}Q${X(0.5)} ${Y(0.52)} ${X(0.88)} ${Y(0.26)}" fill="none" stroke="${TWINE}" stroke-width="0.02"/>`,
      ...[0.14, 0.32, 0.5, 0.68, 0.86].map(leaf),
    ];
  }
  if (kind === "stocking") {
    return [
      shade,
      `<path d="M${X(0.3)} ${Y(0.9)}V${Y(0.14)}H${X(0.5)}" fill="none" stroke="${WOOD_DARK}" stroke-width="0.04"/>`,
      `<path d="M${X(0.4)} ${Y(0.26)}H${X(0.62)}V${Y(0.58)}Q${X(0.62)} ${Y(0.66)} ${X(0.74)} ${Y(0.68)}Q${X(0.82)} ${Y(0.72)} ${X(0.76)} ${Y(0.8)}H${X(0.54)}Q${X(0.4)} ${Y(0.8)} ${X(0.4)} ${Y(0.66)}z" fill="${fill}" ${stroke}/>`,
      `<rect x="${X(0.37)}" y="${Y(0.18)}" width="0.28" height="0.11" rx="0.04" fill="${SNOW}"/>`,
    ];
  }
  if (kind === "menorah") {
    const arms = [1, 2, 3, 4].map((i) => {
      const r = n(i * 0.094);
      return `<path d="M${X(0.5 - i * 0.094)} ${Y(0.44)}a${r} ${r} 0 0 0 ${n(2 * i * 0.094)} 0" fill="none" stroke="${fill}" stroke-width="0.035"/>`;
    });
    const candles = Array.from({ length: 9 }, (_, i) => {
      const top = i === 4 ? 0.22 : 0.3;
      return `<rect x="${X(0.1 + i * 0.094)}" y="${Y(top)}" width="0.05" height="${n(0.44 - top)}" fill="${CANDLE}"/>`;
    });
    return [
      shade,
      `<path d="M${X(0.36)} ${Y(0.88)}H${X(0.64)}L${X(0.6)} ${Y(0.8)}H${X(0.4)}z" fill="${fill}" stroke="${BRASS_DARK}" stroke-width="0.02"/>`,
      `<path d="M${X(0.5)} ${Y(0.8)}V${Y(0.44)}" stroke="${fill}" stroke-width="0.04"/>`,
      ...arms,
      ...candles,
    ];
  }
  if (kind === "dreidel") {
    return [
      shade,
      `<rect x="${X(0.47)}" y="${Y(0.2)}" width="0.06" height="0.13" fill="${DREIDEL_LIGHT}"/>`,
      `<path d="M${X(0.3)} ${Y(0.33)}H${X(0.7)}V${Y(0.62)}L${X(0.5)} ${Y(0.86)}L${X(0.3)} ${Y(0.62)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.5)} ${Y(0.33)}H${X(0.7)}V${Y(0.62)}L${X(0.5)} ${Y(0.86)}z" fill="${DREIDEL_LIGHT}" opacity="0.55"/>`,
    ];
  }
  if (kind === "bird_bath") {
    // A round stone basin on a stem, with a disc of water in it.
    return [
      shade,
      `<path d="M${X(0.42)} ${Y(0.88)}H${X(0.58)}L${X(0.56)} ${Y(0.5)}H${X(0.44)}z" fill="${fill}" ${stroke}/>`,
      `<ellipse cx="${X(0.5)}" cy="${Y(0.88)}" rx="0.17" ry="0.055" fill="${fill}" ${stroke}/>`,
      `<ellipse cx="${X(0.5)}" cy="${Y(0.46)}" rx="0.3" ry="0.12" fill="${fill}" ${stroke}/>`,
      `<ellipse cx="${X(0.5)}" cy="${Y(0.45)}" rx="0.22" ry="0.08" fill="${POND_WATER}"/>`,
    ];
  }
  if (kind === "beehive") {
    // A straw skep: three stacked domes with a doorway at its foot.
    const band = (i: number, w: number) =>
      `<rect x="${X(0.5 - w / 2)}" y="${Y(0.46 + i * 0.14)}" width="${n(w)}" height="0.13" rx="0.06" fill="${fill}" ${stroke}/>`;
    return [
      shade,
      `<path d="M${X(0.22)} ${Y(0.88)}H${X(0.78)}L${X(0.74)} ${Y(0.78)}H${X(0.26)}z" fill="${STRAW_DEEP}" ${stroke}/>`,
      band(2, 0.56),
      band(1, 0.46),
      band(0, 0.34),
      `<path d="M${X(0.44)} ${Y(0.88)}v-0.1a0.06 0.06 0 0 1 0.12 0V${Y(0.88)}z" fill="${WOOD_DARK}"/>`,
    ];
  }
  if (kind === "scarecrow") {
    return [
      shade,
      `<path d="M${X(0.5)} ${Y(0.92)}V${Y(0.3)}M${X(0.13)} ${Y(0.44)}H${X(0.87)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
      `<path d="M${X(0.24)} ${Y(0.38)}H${X(0.76)}L${X(0.68)} ${Y(0.72)}H${X(0.32)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.13)} ${Y(0.44)}l-0.06 0.08M${X(0.87)} ${Y(0.44)}l0.06 0.08" stroke="${STRAW}" stroke-width="0.045" stroke-linecap="round"/>`,
      `<circle cx="${X(0.5)}" cy="${Y(0.27)}" r="0.12" fill="${BURLAP}" ${stroke}/>`,
      `<rect x="${X(0.3)}" y="${Y(0.15)}" width="0.4" height="0.06" rx="0.03" fill="${STRAW}" ${stroke}/>`,
      `<rect x="${X(0.4)}" y="${Y(0.05)}" width="0.2" height="0.12" rx="0.03" fill="${STRAW}" ${stroke}/>`,
    ];
  }
  return [
    shade,
    `<path d="M${X(0.18)} ${Y(0.6)}V${Y(0.92)}M${X(0.82)} ${Y(0.6)}V${Y(0.92)}M${X(0.24)} ${Y(0.2)}V${Y(0.6)}M${X(0.76)} ${Y(0.2)}V${Y(0.6)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
    `<rect x="${X(0.11)}" y="${Y(0.16)}" width="0.78" height="0.12" rx="0.03" fill="${fill}" ${stroke}/>`,
    `<rect x="${X(0.11)}" y="${Y(0.33)}" width="0.78" height="0.12" rx="0.03" fill="${fill}" ${stroke}/>`,
    `<rect x="${X(0.06)}" y="${Y(0.52)}" width="0.88" height="0.14" rx="0.04" fill="${fill}" ${stroke}/>`,
  ];
}

const STEM = "#5f9a43";
const LEAF = "#6fae4c";
/** A pumpkin before it ripens, swelling toward its color. */
const BUD = "#8cbf5a";
/** How far along a crop on a stem sets its fruit. The same number is in the client's `paintCrop`. */
const FRUIT_SET = 0.45;
const PUMPKIN_STEM = "#76703a";
/** The thin dark edge around each fruit. */
const FRUIT_EDGE = ' stroke="rgba(43, 38, 32, 0.35)" stroke-width="0.02"';

/** `a` moved `t` of the way toward `b`, both #rrggbb; `a` when either isn't one. */
function mixColor(a: string, b: string, t: number): string {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!hex.test(a) || !hex.test(b)) return a;
  const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  let out = "#";
  for (let i = 1; i < 7; i += 2) {
    const from = Number.parseInt(a.slice(i, i + 2), 16);
    const to = Number.parseInt(b.slice(i, i + 2), 16);
    out += Math.round(from + (to - from) * k)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

/**
 * An oval as a path, turned `turn` degrees, so the hearth's shadow stays the photo's only ellipse.
 * `edge` is our own stroke attributes, or nothing.
 */
function oval(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  turn: number,
  fill: string,
  edge = "",
): string {
  const x = n(cx);
  const y = n(cy);
  const spin = turn ? ` transform="rotate(${n(turn)} ${x} ${y})"` : "";
  return `<path d="M${n(cx - rx)} ${y}a${n(rx)} ${n(ry)} 0 1 0 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 0 -${n(rx * 2)} 0z"${spin} fill="${fill}"${edge}/>`;
}

/**
 * A crop on its planter, as `packages/client/src/render.ts` paints it: a sprout that grows taller,
 * its three fruit or flowers setting at `FRUIT_SET` and swelling from a green bud to the crop's own
 * color, full at ready; or, for a crop on a vine like a pumpkin, a vine along the soil, its fruit
 * swelling the same way, with a stem once it's ripe. Fruit before ready is what tells one crop from
 * another at a glance, so a photo of a garden reads as tomatoes and wheat rather than sprouts. The
 * planter is the block under it, so the same 0.05 inset and 0.9 tile size apply.
 */
function cropSvg(c: PlotCrop): string[] {
  const done = Number.isFinite(c.done) ? Math.max(0, Math.min(1, c.done)) : 0;
  const fill = safeColor(c.fill);
  const size = 0.9;
  const cx = c.x + 0.05 + size / 2;
  const top = c.y + 0.05;
  const line = (d: string, stroke: string, width: number) =>
    `<path d="${d}" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="round" fill="none"/>`;
  if (c.vine) {
    const base = top + size * 0.7;
    const spread = size * (0.14 + 0.2 * done);
    const leaf = size * (0.07 + 0.07 * done);
    const out = [
      line(
        `M${n(cx - spread)} ${n(base)}Q${n(cx)} ${n(base - size * 0.14)} ${n(cx + spread)} ${n(base)}`,
        STEM,
        size / 16,
      ),
      ...[-1, 1].map((side) =>
        oval(cx + side * spread * 0.85, base - leaf * 0.3, leaf, leaf * 0.6, side * 23, LEAF),
      ),
    ];
    if (done <= 0.2) return out;
    const ripe = done >= 1;
    const swell = (done - 0.2) / 0.8;
    const r = size * (0.08 + 0.15 * swell);
    const y = base - r * 0.55;
    const skin = ripe ? fill : mixColor(BUD, fill, swell * 0.5);
    for (const dx of [-0.5, 0.5, 0])
      out.push(oval(cx + dx * r, y, r * 0.72, r * 0.82, 0, skin, FRUIT_EDGE));
    if (ripe)
      out.push(
        line(
          `M${n(cx)} ${n(y - r * 0.7)}L${n(cx + r * 0.15)} ${n(y - r * 1.05)}`,
          PUMPKIN_STEM,
          size / 18,
        ),
      );
    return out;
  }
  const base = top + size * 0.66;
  const tall = size * (0.18 + 0.32 * done);
  const leaf = size * (0.08 + 0.08 * done);
  const out = [
    line(`M${n(cx)} ${n(base)}V${n(base - tall)}`, STEM, size / 14),
    ...[-1, 1].map((side) =>
      oval(cx + side * leaf, base - tall * 0.55, leaf, leaf * 0.5, side * 29, LEAF),
    ),
  ];
  if (done >= FRUIT_SET) {
    const ripe = done >= 1;
    const swell = (done - FRUIT_SET) / (1 - FRUIT_SET);
    const r = size * (0.05 + 0.04 * swell);
    const skin = ripe ? fill : mixColor(BUD, fill, 0.55 + 0.45 * swell);
    for (const [dx, dy] of [
      [-0.16, -0.05],
      [0.16, -0.1],
      [0, -0.2],
    ] as const) {
      out.push(
        `<circle cx="${n(cx + dx * size)}" cy="${n(base - tall + dy * size + tall * 0.4)}" r="${n(r)}" fill="${skin}"${FRUIT_EDGE}/>`,
      );
    }
  }
  return out;
}

/** A number kept to a tile's own small range, or 0. */
const unit = (v: number, max = 1.5) =>
  Number.isFinite(v) ? n(Math.max(-0.5, Math.min(max, v))) : 0;

/** A path or flooring's shapes on tile (x, y), from the sim's look: numbers and checked colors only. */
function pavingSvg(p: PlotPaving, x: number, y: number): string[] {
  const out: string[] = [];
  if (p.fill) {
    out.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${safeColor(p.fill)}"/>`);
  }
  for (const m of p.marks) out.push(...markSvg(m, x, y, 1));
  return out;
}

/**
 * One of the sim's marks (a path's or a wall's), its tile-unit box `k` across with its top left at
 * (x, y): numbers kept to the tile and checked colors only.
 */
function markSvg(m: PlotMark, x: number, y: number, k: number): string[] {
  const at = (v: number) => n(k * unit(v));
  if (m.shape === "rect") {
    return [
      `<rect x="${n(x + k * unit(m.x))}" y="${n(y + k * unit(m.y))}" width="${at(m.w)}" height="${at(m.h)}" rx="${at(m.r)}" fill="${safeColor(m.fill)}"/>`,
    ];
  }
  if (m.shape === "circle") {
    return [
      `<circle cx="${n(x + k * unit(m.cx))}" cy="${n(y + k * unit(m.cy))}" r="${at(m.r)}" fill="${safeColor(m.fill)}"/>`,
    ];
  }
  if (m.shape === "ellipse") {
    // A turned oval, as a path, so the hearth's shadow stays the photo's only ellipse.
    const cx = n(x + k * unit(m.cx));
    const cy = n(y + k * unit(m.cy));
    const rx = at(m.rx);
    const ry = at(m.ry);
    const turn = Number.isFinite(m.turn) ? Math.round(m.turn) % 360 : 0;
    return [
      `<path d="M${n(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${n(rx * 2)} 0a${rx} ${ry} 0 1 0 -${n(rx * 2)} 0z" transform="rotate(${turn} ${cx} ${cy})" fill="${safeColor(m.fill)}"/>`,
    ];
  }
  if (m.shape === "line") {
    return [
      `<path d="M${n(x + k * unit(m.x1))} ${n(y + k * unit(m.y1))}L${n(x + k * unit(m.x2))} ${n(y + k * unit(m.y2))}" stroke="${safeColor(m.stroke)}" stroke-width="${at(m.width)}" stroke-linecap="round" fill="none"/>`,
    ];
  }
  return [];
}

const STONE_LO = "#8f887c";
const STONE_HI = "#c4beb2";
const FLOWERS = ["#e58fb6", "#f2b84b", "#fff4d6", "#a98bd8"];
const BOOKS = ["#b4532f", "#7cb9dd", "#f2b84b", "#5e7f45", "#a98bd8"];
/** Cream piping on a cushion, and a bed's sheet. */
const LINEN = "#f1e8d6";

/**
 * One piece of furniture on tile (x, y), following its picture in the world: a table, a chair, a
 * bookshelf, a barrel, a signpost, a lamp post, a well, a low stone wall that joins the walls
 * beside it, a campfire, a flower box, a piece you rest on (an armchair, a sofa, a bed, or a rocking
 * chair), a surface (a desk, a side table, a dresser, or a coffee table), a wardrobe, a piano, a
 * bathtub, a fireplace, an aquarium, a coat rack, a floor lamp, or a potted tree. Only numbers and
 * checked colors go in, and no ellipses.
 */
function furnitureSvg(
  kind: PlotFurniture,
  x: number,
  y: number,
  fill: string,
  joins: { n: boolean; e: boolean; s: boolean; w: boolean },
): string[] {
  const X = (f: number) => n(x + f);
  const Y = (f: number) => n(y + f);
  const stroke = `stroke="${EDGE}" stroke-width="0.035" stroke-linejoin="round"`;
  const shade = `<rect x="${X(0.14)}" y="${Y(0.86)}" width="0.72" height="0.1" rx="0.05" fill="rgba(74, 52, 28, 0.2)"/>`;
  const rect = (
    fx: number,
    fy: number,
    w: number,
    h: number,
    color: string,
    r = 0.03,
    edge = true,
  ) =>
    `<rect x="${X(fx)}" y="${Y(fy)}" width="${w}" height="${h}" rx="${r}" fill="${color}"${edge ? ` ${stroke}` : ""}/>`;
  const dot = (fx: number, fy: number, r: number, color: string) =>
    `<circle cx="${X(fx)}" cy="${Y(fy)}" r="${r}" fill="${color}"/>`;
  switch (kind) {
    case "table":
      return [
        shade,
        rect(0.2, 0.5, 0.08, 0.38, WOOD_DARK, 0.02, false),
        rect(0.72, 0.5, 0.08, 0.38, WOOD_DARK, 0.02, false),
        rect(0.08, 0.32, 0.84, 0.2, fill, 0.05),
      ];
    case "chair":
      return [
        shade,
        rect(0.27, 0.12, 0.08, 0.5, fill, 0.02),
        rect(0.65, 0.12, 0.08, 0.5, fill, 0.02),
        rect(0.27, 0.16, 0.46, 0.09, fill, 0.02),
        rect(0.29, 0.66, 0.07, 0.24, WOOD_DARK, 0.02, false),
        rect(0.64, 0.66, 0.07, 0.24, WOOD_DARK, 0.02, false),
        rect(0.2, 0.56, 0.6, 0.12, fill, 0.03),
      ];
    case "bookshelf":
      return [
        shade,
        rect(0.16, 0.06, 0.68, 0.84, fill, 0.04),
        rect(0.22, 0.12, 0.56, 0.72, WOOD_DARK, 0.02, false),
        ...[0.14, 0.4, 0.64].flatMap((fy, row) =>
          [0, 1, 2, 3].map((i) =>
            rect(
              0.24 + i * 0.13,
              fy,
              0.1,
              0.2,
              BOOKS[(i + row) % BOOKS.length] as string,
              0.01,
              false,
            ),
          ),
        ),
      ];
    case "desk":
      return [
        shade,
        rect(0.12, 0.5, 0.08, 0.38, WOOD_DARK, 0.02, false),
        rect(0.56, 0.48, 0.32, 0.4, fill, 0.03),
        rect(0.6, 0.56, 0.24, 0.04, WOOD_DARK, 0.01, false),
        rect(0.08, 0.32, 0.84, 0.18, fill, 0.04),
      ];
    case "side_table":
      return [
        shade,
        rect(0.3, 0.5, 0.07, 0.38, WOOD_DARK, 0.02, false),
        rect(0.63, 0.5, 0.07, 0.38, WOOD_DARK, 0.02, false),
        rect(0.22, 0.36, 0.56, 0.16, fill, 0.06),
      ];
    case "dresser":
      return [
        shade,
        rect(0.12, 0.16, 0.76, 0.72, fill, 0.04),
        ...[0.24, 0.46, 0.68].map((fy) => rect(0.18, fy, 0.64, 0.16, WOOD_DARK, 0.02, false)),
        ...[0.32, 0.54, 0.76].map((fy) => dot(0.5, fy, 0.03, "#e7c27a")),
      ];
    case "barrel":
      return [
        shade,
        rect(0.22, 0.14, 0.56, 0.74, fill, 0.18),
        `<path d="M${X(0.21)} ${Y(0.32)}h0.58M${X(0.21)} ${Y(0.7)}h0.58" stroke="#5d5a55" stroke-width="0.05" fill="none"/>`,
      ];
    case "signpost":
      return [
        shade,
        rect(0.46, 0.18, 0.08, 0.72, WOOD_DARK, 0.02, false),
        `<path d="M${X(0.16)} ${Y(0.2)}h0.56l0.12 0.1-0.12 0.1h-0.56z" fill="${fill}" ${stroke}/>`,
        `<path d="M${X(0.84)} ${Y(0.48)}h-0.56l-0.12 0.1 0.12 0.1h0.56z" fill="${fill}" ${stroke}/>`,
      ];
    case "lamp_post":
      return [
        shade,
        dot(0.5, 0.24, 0.24, "rgba(242, 181, 68, 0.28)"),
        rect(0.46, 0.3, 0.08, 0.6, fill, 0.02, false),
        rect(0.38, 0.84, 0.24, 0.07, fill, 0.02, false),
        rect(0.38, 0.14, 0.24, 0.2, "#f9d27a", 0.04),
        `<path d="M${X(0.34)} ${Y(0.15)}L${X(0.5)} ${Y(0.04)}L${X(0.66)} ${Y(0.15)}z" fill="${fill}"/>`,
      ];
    case "well":
      return [
        shade,
        rect(0.2, 0.22, 0.06, 0.46, WOOD_DARK, 0.02, false),
        rect(0.74, 0.22, 0.06, 0.46, WOOD_DARK, 0.02, false),
        `<path d="M${X(0.1)} ${Y(0.26)}L${X(0.5)} ${Y(0.04)}L${X(0.9)} ${Y(0.26)}z" fill="#b4532f" ${stroke}/>`,
        rect(0.16, 0.56, 0.68, 0.34, fill, 0.08),
        rect(0.16, 0.54, 0.68, 0.1, STONE_HI, 0.05),
        rect(0.24, 0.56, 0.52, 0.06, "#3f5f6f", 0.03, false),
      ];
    case "stone_wall": {
      const x0 = joins.w ? 0 : 0.2;
      const x1 = joins.e ? 1 : 0.8;
      return [
        ...(joins.n ? [rect(0.2, 0, 0.6, 0.45, fill, 0, false)] : []),
        ...(joins.s ? [rect(0.2, 0.85, 0.6, 0.15, fill, 0, false)] : []),
        rect(x0, 0.42, n(x1 - x0), 0.48, fill, 0.04),
        `<path d="M${X(x0)} ${Y(0.66)}H${X(x1)}" stroke="${STONE_LO}" stroke-width="0.03" fill="none"/>`,
        rect(x0, 0.36, n(x1 - x0), 0.1, STONE_HI, 0.04, false),
      ];
    }
    case "campfire":
      return [
        dot(0.5, 0.58, 0.32, "rgba(242, 181, 68, 0.22)"),
        `<path d="M${X(0.22)} ${Y(0.8)}L${X(0.78)} ${Y(0.66)}M${X(0.26)} ${Y(0.66)}L${X(0.76)} ${Y(0.8)}" stroke="${WOOD_DARK}" stroke-width="0.09" stroke-linecap="round" fill="none"/>`,
        `<path d="M${X(0.5)} ${Y(0.18)}C${X(0.66)} ${Y(0.36)} ${X(0.72)} ${Y(0.5)} ${X(0.66)} ${Y(0.64)}C${X(0.6)} ${Y(0.76)} ${X(0.4)} ${Y(0.76)} ${X(0.34)} ${Y(0.64)}C${X(0.28)} ${Y(0.5)} ${X(0.4)} ${Y(0.4)} ${X(0.5)} ${Y(0.18)}z" fill="${fill}" ${stroke}/>`,
        `<path d="M${X(0.5)} ${Y(0.42)}C${X(0.58)} ${Y(0.52)} ${X(0.6)} ${Y(0.6)} ${X(0.56)} ${Y(0.66)}C${X(0.53)} ${Y(0.71)} ${X(0.47)} ${Y(0.71)} ${X(0.44)} ${Y(0.66)}C${X(0.4)} ${Y(0.6)} ${X(0.44)} ${Y(0.52)} ${X(0.5)} ${Y(0.42)}z" fill="#f2b84b"/>`,
        ...[0.16, 0.33, 0.5, 0.67, 0.84].map((fx, i) =>
          dot(fx, i === 0 || i === 4 ? 0.8 : 0.86, 0.07, "#a39d93"),
        ),
      ];
    case "jack_o_lantern":
      return [
        dot(0.5, 0.56, 0.34, "rgba(242, 181, 68, 0.22)"),
        dot(0.32, 0.62, 0.2, fill),
        dot(0.68, 0.62, 0.2, fill),
        dot(0.5, 0.6, 0.24, fill),
        `<path d="M${X(0.48)} ${Y(0.37)}L${X(0.52)} ${Y(0.24)}" stroke="#6a6136" stroke-width="0.06" stroke-linecap="round"/>`,
        `<path d="M${X(0.36)} ${Y(0.58)}L${X(0.42)} ${Y(0.48)}L${X(0.48)} ${Y(0.58)}zM${X(0.52)} ${Y(0.58)}L${X(0.58)} ${Y(0.48)}L${X(0.64)} ${Y(0.58)}zM${X(0.36)} ${Y(0.66)}Q${X(0.5)} ${Y(0.78)} ${X(0.64)} ${Y(0.66)}z" fill="#ffd36b"/>`,
      ];
    case "flower_box":
      return [
        shade,
        ...[0.24, 0.42, 0.6, 0.78].map((fx, i) =>
          dot(fx, 0.34 + (i % 2) * 0.06, 0.08, FLOWERS[i] as string),
        ),
        rect(0.1, 0.5, 0.8, 0.36, fill, 0.05),
        rect(0.14, 0.46, 0.72, 0.07, "#6a4a33", 0.02, false),
      ];
    case "armchair":
      return [
        shade,
        rect(0.2, 0.2, 0.6, 0.34, fill, 0.08),
        rect(0.14, 0.42, 0.16, 0.42, fill, 0.06),
        rect(0.7, 0.42, 0.16, 0.42, fill, 0.06),
        rect(0.28, 0.5, 0.44, 0.3, fill, 0.05),
        rect(0.3, 0.52, 0.4, 0.06, LINEN, 0.03, false),
      ];
    case "sofa":
      return [
        shade,
        rect(0.06, 0.24, 0.88, 0.3, fill, 0.08),
        rect(0.04, 0.44, 0.12, 0.42, fill, 0.05),
        rect(0.84, 0.44, 0.12, 0.42, fill, 0.05),
        rect(0.16, 0.5, 0.34, 0.3, fill, 0.04),
        rect(0.5, 0.5, 0.34, 0.3, fill, 0.04),
        rect(0.18, 0.52, 0.64, 0.05, LINEN, 0.02, false),
      ];
    case "bed":
      return [
        shade,
        rect(0.12, 0.06, 0.76, 0.86, WOOD_DARK, 0.05),
        rect(0.16, 0.14, 0.68, 0.72, LINEN, 0.04, false),
        rect(0.26, 0.17, 0.48, 0.14, "#fffaf0", 0.05),
        rect(0.16, 0.38, 0.68, 0.48, fill, 0.04),
        `<path d="M${X(0.16)} ${Y(0.44)}H${X(0.84)}" stroke="${LINEN}" stroke-width="0.03" fill="none"/>`,
      ];
    case "wardrobe":
      return [
        shade,
        rect(0.18, 0.06, 0.64, 0.82, fill, 0.04),
        rect(0.22, 0.16, 0.26, 0.68, "rgba(60, 36, 20, 0.3)", 0.02, false),
        rect(0.52, 0.16, 0.26, 0.68, "rgba(60, 36, 20, 0.3)", 0.02, false),
        dot(0.45, 0.5, 0.025, "#e7c27a"),
        dot(0.55, 0.5, 0.025, "#e7c27a"),
        rect(0.14, 0.02, 0.72, 0.08, fill, 0.03),
      ];
    case "rocking_chair":
      return [
        shade,
        rect(0.27, 0.1, 0.08, 0.5, fill, 0.02),
        rect(0.65, 0.1, 0.08, 0.5, fill, 0.02),
        rect(0.41, 0.2, 0.04, 0.36, fill, 0.01, false),
        rect(0.55, 0.2, 0.04, 0.36, fill, 0.01, false),
        rect(0.26, 0.13, 0.48, 0.09, fill, 0.02),
        rect(0.3, 0.66, 0.06, 0.2, WOOD_DARK, 0.02, false),
        rect(0.64, 0.66, 0.06, 0.2, WOOD_DARK, 0.02, false),
        rect(0.2, 0.56, 0.6, 0.12, fill, 0.03),
        `<path d="M${X(0.1)} ${Y(0.82)}Q${X(0.5)} ${Y(1)} ${X(0.9)} ${Y(0.82)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round" fill="none"/>`,
      ];
    case "piano":
      return [
        shade,
        rect(0.16, 0.62, 0.68, 0.26, fill, 0.03),
        rect(0.12, 0.1, 0.76, 0.42, fill, 0.04),
        rect(0.4, 0.17, 0.2, 0.16, "#fffaf0", 0.01, false),
        rect(0.08, 0.5, 0.84, 0.14, LINEN, 0.02),
        ...[0.18, 0.28, 0.46, 0.56, 0.66, 0.8].map((fx) =>
          rect(fx, 0.5, 0.05, 0.07, "#1f1a18", 0.005, false),
        ),
      ];
    case "bathtub":
      return [
        shade,
        dot(0.24, 0.86, 0.05, "#e7c27a"),
        dot(0.76, 0.86, 0.05, "#e7c27a"),
        `<path d="M${X(0.1)} ${Y(0.44)}H${X(0.9)}C${X(0.9)} ${Y(0.7)} ${X(0.8)} ${Y(0.84)} ${X(0.66)} ${Y(0.84)}H${X(0.34)}C${X(0.2)} ${Y(0.84)} ${X(0.1)} ${Y(0.7)} ${X(0.1)} ${Y(0.44)}z" fill="${fill}" ${stroke}/>`,
        dot(0.3, 0.34, 0.06, "#ffffff"),
        dot(0.4, 0.3, 0.045, "#ffffff"),
        dot(0.62, 0.33, 0.05, "#ffffff"),
        rect(0.06, 0.38, 0.88, 0.1, fill, 0.05),
        rect(0.12, 0.4, 0.76, 0.04, "#9fd3e0", 0.02, false),
      ];
    case "fireplace":
      return [
        shade,
        rect(0.1, 0.18, 0.8, 0.72, fill, 0.03),
        `<path d="M${X(0.32)} ${Y(0.9)}V${Y(0.58)}Q${X(0.32)} ${Y(0.4)} ${X(0.5)} ${Y(0.4)}Q${X(0.68)} ${Y(0.4)} ${X(0.68)} ${Y(0.58)}V${Y(0.9)}z" fill="#3a2a22"/>`,
        `<path d="M${X(0.5)} ${Y(0.5)}C${X(0.6)} ${Y(0.62)} ${X(0.62)} ${Y(0.7)} ${X(0.6)} ${Y(0.78)}C${X(0.57)} ${Y(0.86)} ${X(0.43)} ${Y(0.86)} ${X(0.4)} ${Y(0.78)}C${X(0.38)} ${Y(0.7)} ${X(0.42)} ${Y(0.62)} ${X(0.5)} ${Y(0.5)}z" fill="#e0603f"/>`,
        dot(0.5, 0.76, 0.06, "#f2b84b"),
        `<path d="M${X(0.36)} ${Y(0.88)}L${X(0.64)} ${Y(0.82)}M${X(0.36)} ${Y(0.82)}L${X(0.64)} ${Y(0.88)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round" fill="none"/>`,
        rect(0.04, 0.12, 0.92, 0.1, WOOD, 0.03),
      ];
    case "aquarium":
      return [
        shade,
        rect(0.16, 0.56, 0.68, 0.32, WOOD, 0.03),
        rect(0.1, 0.14, 0.8, 0.44, fill, 0.04),
        rect(0.12, 0.48, 0.76, 0.08, "#e6cfa3", 0.01, false),
        `<path d="M${X(0.36)} ${Y(0.32)}l-0.06 -0.05v0.1z" fill="#e0603f"/>`,
        dot(0.44, 0.32, 0.06, "#f2b84b"),
        dot(0.66, 0.42, 0.04, "#e58fb6"),
        rect(0.08, 0.1, 0.84, 0.06, WOOD_DARK, 0.02, false),
      ];
    case "coffee_table":
      return [
        shade,
        rect(0.14, 0.56, 0.07, 0.32, WOOD_DARK, 0.02, false),
        rect(0.79, 0.56, 0.07, 0.32, WOOD_DARK, 0.02, false),
        rect(0.18, 0.72, 0.64, 0.05, WOOD_DARK, 0.01, false),
        rect(0.06, 0.48, 0.88, 0.14, fill, 0.06),
      ];
    case "coat_rack":
      return [
        `<path d="M${X(0.28)} ${Y(0.9)}L${X(0.5)} ${Y(0.8)}L${X(0.72)} ${Y(0.9)}" stroke="${fill}" stroke-width="0.06" stroke-linecap="round" fill="none"/>`,
        rect(0.47, 0.1, 0.06, 0.78, fill, 0.02, false),
        dot(0.5, 0.1, 0.05, fill),
        rect(0.3, 0.2, 0.08, 0.4, "#e0603f", 0.02),
        rect(0.56, 0.2, 0.2, 0.46, "#5f86b5", 0.06),
      ];
    case "floor_lamp":
      return [
        shade,
        dot(0.5, 0.22, 0.24, "rgba(242, 181, 68, 0.28)"),
        rect(0.47, 0.32, 0.06, 0.54, WOOD_DARK, 0.02, false),
        rect(0.34, 0.84, 0.32, 0.07, STONE_HI, 0.03),
        `<path d="M${X(0.32)} ${Y(0.34)}L${X(0.4)} ${Y(0.08)}H${X(0.6)}L${X(0.68)} ${Y(0.34)}z" fill="${fill}" ${stroke}/>`,
      ];
    case "potted_tree":
      return [
        shade,
        rect(0.46, 0.36, 0.08, 0.3, WOOD_DARK, 0.02, false),
        dot(0.34, 0.38, 0.16, fill),
        dot(0.66, 0.38, 0.16, fill),
        dot(0.5, 0.26, 0.22, fill),
        `<path d="M${X(0.28)} ${Y(0.62)}H${X(0.72)}L${X(0.68)} ${Y(0.9)}H${X(0.32)}z" fill="${WOOD}" ${stroke}/>`,
        rect(0.24, 0.58, 0.52, 0.08, WOOD, 0.02),
      ];
  }
}

/**
 * Where the home picture stands, in pixels inside a `px` square photo: over the hearth (or the
 * middle of the plot), at most 3.6 tiles across or tall, its bottom on the hearth's tile.
 */
export function homeArtBox(
  c: Pick<PlotCard, "size" | "hearth" | "homeArt">,
  px: number,
): { left: number; top: number; width: number; height: number } | undefined {
  const art = c.homeArt;
  if (!art || art.width <= 0 || art.height <= 0) return undefined;
  const S = Math.max(1, Math.floor(c.size));
  const tile = px / S;
  const middle = Math.floor((S - 1) / 2);
  const anchor = c.hearth ?? { x: middle, y: middle };
  const max = tile * Math.min(3.6, S - 1);
  const fit = Math.min(max / art.width, max / art.height);
  const width = Math.round(art.width * fit);
  const height = Math.round(art.height * fit);
  const cx = (anchor.x + 0.5) * tile;
  const bottom = (anchor.y + 0.5) * tile + tile * 0.475;
  return {
    left: Math.round(Math.max(0, Math.min(px - width, cx - width / 2))),
    top: Math.round(Math.max(0, bottom - height)),
    width,
    height,
  };
}
