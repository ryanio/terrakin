/**
 * A small drawing of one plot from above, painted from the world snapshot the page already has: the
 * ground in its biome, the owner's theme tint, blocks in their colors (themed as in the world),
 * crops, things on display, hearths, and whoever is standing there now. It uses the world's own
 * palette (`packages/sim/src/palette.ts`), so a plot looks the same here, on the map, and in a plot
 * photo.
 * A drawing costs no request and no upload, which is why the plot cards use it rather than plot
 * photos (RFC 0020).
 */
import { everyoneIn, type WorldSnapshot } from "@terrakin/protocol";
import {
  alphaHex,
  blockFill,
  CROP_HEX,
  FLOORS,
  type GroundKind,
  groundTile,
  HEARTH_COLOR,
  HEARTH_DOOR,
  holdsRoof,
  isDecorKind,
  PAPER,
  type RoofTop,
  roofShape,
  roofTone,
  SEA_LOOK,
  THEME_INFO,
  THEME_TINT_ALPHA,
  tileKey,
} from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";
import { h } from "@terrakin/ui/dom";
import { paintGround } from "@terrakin/ui/ground-art";
import { bridgeOf, seaOf } from "./lands";
import { paintRoofTop, roofShade } from "./render/roofs";

/** One tile's worth of a plot drawing, in tiles from the plot's north-west corner. */
export type PlotMark =
  | { x: number; y: number; kind: "ground"; fill: string }
  | { x: number; y: number; kind: "path"; ground: GroundKind }
  | { x: number; y: number; kind: "block"; fill: string; glass: boolean; decor: boolean }
  | { x: number; y: number; kind: "crop"; fill: string; ripe: boolean }
  | { x: number; y: number; kind: "display" }
  | { x: number; y: number; kind: "hearth" }
  /** A tile of the home's roof (RFC 0041), lit by how high its corners stand (`high`, 0 to 1). */
  | { x: number; y: number; kind: "roof"; fill: string; high: number }
  /** What stands on that roof's ridge (RFC 0041), over the roof and under the people. */
  | { x: number; y: number; kind: "roofTop"; top: RoofTop }
  /** An online resident standing there (RFC 0020). It says someone is here, never who. */
  | { x: number; y: number; kind: "here" };

/** The floor a snapshot entry is on: absent is the ground floor. */
const floorOf = (t: { floor?: number | undefined }) => t.floor ?? 0;

/** A sprout's green while a crop is still growing. */
const GROWING = "#7fae55";

/**
 * What to paint for plot (px, py), back to front: the ground in its season, then paths and flooring,
 * blocks, crops, displays, and hearths, then the flooring and blocks of each floor above the ground
 * floor (RFC 0028), and last whoever is standing there online. `tint` is the owner's theme over the
 * ground, under the paths. Pure, so tests pin it.
 *
 * `roof` draws the home's roof over all of it (RFC 0041), which only a plot drawn as a neighbor
 * wants: a drawing of one plot is about that plot, so its roof lifts away as it does on the map
 * for the plot you stand on, and a roof from above is opaque, so leaving it on would hide the
 * home, the hearth and the garden the card is there to show.
 */
export function plotMarks(
  world: WorldSnapshot,
  px: number,
  py: number,
  o: { roof?: boolean } = {},
): { size: number; tint?: string; marks: PlotMark[] } {
  const size = world.config.plotSize;
  const x0 = px * size;
  const y0 = py * size;
  const here = (t: { x: number; y: number }) =>
    t.x >= x0 && t.x < x0 + size && t.y >= y0 && t.y < y0 + size;
  const plot = world.plots.find((p) => p.px === px && p.py === py);
  const owner = plot ? everyoneIn(world).find((r) => r.id === plot.ownerId) : undefined;
  const palette = owner?.theme ? THEME_INFO[owner.theme]?.palette : undefined;
  const marks: PlotMark[] = [];
  // Open water between lands, and the timber over it (RFC 0038): a thumbnail of an island plot
  // shows the sea around it. Neither exists in a world of one grid.
  const sea = seaOf(world.config, world.lands);
  const bridge = bridgeOf(world.lands);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tx = x0 + x;
      const ty = y0 + y;
      const fill = sea?.(tx, ty)
        ? SEA_LOOK.water
        : bridge.has(tileKey(tx, ty))
          ? SEA_LOOK.deck
          : groundTile(world.config, tx, ty, false, world.season).fill;
      marks.push({ x, y, kind: "ground", fill });
    }
  }
  const build = (floor: number) => {
    for (const g of world.ground ?? []) {
      if (floorOf(g) !== floor || !here(g)) continue;
      marks.push({ x: g.x - x0, y: g.y - y0, kind: "path", ground: g.ground });
    }
    for (const b of world.blocks) {
      if (floorOf(b) !== floor || !here(b)) continue;
      const glass = b.block === "glass";
      marks.push({
        x: b.x - x0,
        y: b.y - y0,
        kind: "block",
        fill: blockFill(b.block, glass ? undefined : palette),
        glass,
        decor: isDecorKind(b.block),
      });
    }
  };
  build(0);
  for (const c of world.crops ?? []) {
    if (!here(c)) continue;
    const ripe = world.day !== undefined && world.day >= c.readyDay;
    marks.push({
      x: c.x - x0,
      y: c.y - y0,
      kind: "crop",
      fill: ripe ? CROP_HEX[c.crop] : GROWING,
      ripe,
    });
  }
  for (const d of world.displays ?? []) {
    if (here(d)) marks.push({ x: d.x - x0, y: d.y - y0, kind: "display" });
  }
  for (const r of everyoneIn(world)) {
    if (r.hearth && here(r.hearth)) {
      marks.push({ x: r.hearth.x - x0, y: r.hearth.y - y0, kind: "hearth" });
    }
  }
  for (let floor = 1; floor <= FLOORS.max; floor++) build(floor);
  // A neighbor's roof over all of it (RFC 0041), as the map draws a plot you're not standing on.
  // Reading the walls is only worth it for a plot that draws one, since a page of cards calls this
  // once per plot and the snapshot's blocks are the whole world's.
  let roof: ReturnType<typeof roofShape>;
  if (o.roof) {
    const walls = new Map(
      world.blocks.map((b) => [`${floorOf(b)}|${b.x},${b.y}`, b.block] as const),
    );
    roof = roofShape({
      plotSize: size,
      px,
      py,
      roof: plot?.roof,
      floors: plot?.floors ?? 0,
      wall: (x, y, floor) => holdsRoof(walls.get(`${floor}|${x},${y}`)),
    });
  }
  if (roof) {
    // Winter lies on a roof as it lies on the ground (RFC 0041).
    const fill = roofTone(blockFill(roof.material, palette), world.season);
    for (const t of roof.tiles) {
      marks.push({
        x: t.x - x0,
        y: t.y - y0,
        kind: "roof",
        fill,
        high: (t.h[0] + t.h[1] + t.h[2] + t.h[3]) / 4,
      });
    }
    if (roof.top) {
      marks.push({ x: roof.top.x - x0, y: roof.top.y - y0, kind: "roofTop", top: roof.top.kind });
    }
  }
  // Whoever is standing there now, over everything: a plot with someone on it is the one to visit,
  // and from above they'd be lost under a roof or an upstairs. Online residents only, since the
  // snapshot draws everyone away asleep at their hearth (decision 0086), and no two on one tile.
  const taken = new Set<string>();
  for (const r of everyoneIn(world)) {
    if (!r.online || !here(r) || taken.has(tileKey(r.x, r.y))) continue;
    taken.add(tileKey(r.x, r.y));
    marks.push({ x: r.x - x0, y: r.y - y0, kind: "here" });
  }
  return {
    size,
    ...(palette ? { tint: alphaHex(palette.ground, THEME_TINT_ALPHA) } : {}),
    marks,
  };
}

/** Paint one mark into a tile `t` pixels wide at (left, top). */
export function paint(
  ctx: CanvasRenderingContext2D,
  mark: PlotMark,
  left: number,
  top: number,
  t: number,
) {
  const inset = Math.max(1, t * 0.08);
  switch (mark.kind) {
    case "ground":
      ctx.fillStyle = mark.fill;
      ctx.fillRect(left, top, t, t);
      return;
    case "path":
      paintGround(ctx, mark.ground, left, top, t, t);
      return;
    case "block":
      ctx.globalAlpha = mark.glass ? 0.75 : 1;
      ctx.fillStyle = mark.fill;
      if (mark.decor) {
        // Decor stands smaller than a wall: a rounded piece in the middle of its tile.
        ctx.beginPath();
        ctx.roundRect(left + t * 0.2, top + t * 0.2, t * 0.6, t * 0.6, t * 0.18);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.roundRect(left + inset, top + inset, t - 2 * inset, t - 2 * inset, t * 0.16);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    case "crop":
      ctx.fillStyle = mark.fill;
      ctx.beginPath();
      ctx.arc(left + t / 2, top + t / 2, t * (mark.ripe ? 0.24 : 0.16), 0, Math.PI * 2);
      ctx.fill();
      return;
    case "roof":
      // The map's own shading, so a ridge reads even this small (RFC 0041).
      ctx.fillStyle = roofShade(mark.fill, mark.high);
      ctx.fillRect(left, top, t + 0.5, t + 0.5);
      return;
    case "display":
      ctx.fillStyle = PAPER;
      ctx.beginPath();
      ctx.arc(left + t / 2, top + t * 0.4, t * 0.16, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "hearth": {
      // A tiny house: paper walls, a roof, and a lit door.
      ctx.fillStyle = PAPER;
      ctx.fillRect(left + t * 0.22, top + t * 0.45, t * 0.56, t * 0.42);
      ctx.fillStyle = HEARTH_COLOR;
      ctx.beginPath();
      ctx.moveTo(left + t * 0.12, top + t * 0.5);
      ctx.lineTo(left + t / 2, top + t * 0.12);
      ctx.lineTo(left + t * 0.88, top + t * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = HEARTH_DOOR;
      ctx.fillRect(left + t * 0.42, top + t * 0.62, t * 0.16, t * 0.25);
      return;
    }
    case "roofTop":
      paintRoofTop(ctx, mark.top, left + t / 2, top + t / 2, t);
      return;
    case "here": {
      // A head and shoulders from above, in a rim of paper so it reads over a roof, a dark path,
      // or another figure. No color and no name: the card says someone is here, never who.
      const cx = left + t / 2;
      const rim = Math.max(1, t * 0.07);
      for (const [fill, grow] of [
        [PAPER, rim],
        [BRAND_HEX.ink, 0],
      ] as const) {
        ctx.fillStyle = fill;
        for (const [dy, r] of [
          [0.12, 0.19],
          [-0.12, 0.13],
        ] as const) {
          ctx.beginPath();
          ctx.arc(cx, top + t * (0.5 + dy), t * r + grow, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
  }
}

/**
 * A plot drawn on a canvas `px` CSS pixels square, for a card. `label` says whose plot it is, for
 * screen readers, and gains whoever is standing there, since that is on the drawing and nowhere in
 * the card's words. The owner's name in it is text the canvas never draws.
 */
export function plotThumb(
  world: WorldSnapshot,
  plot: { px: number; py: number },
  label: string,
  px = 96,
): HTMLCanvasElement {
  const canvas = h("canvas", {
    class: "plot-thumb",
    attrs: { role: "img", "aria-label": label, width: px, height: px },
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(px * dpr);
  canvas.height = Math.round(px * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const marks = paintPlot(ctx, world, plot, 0, 0, canvas.width / world.config.plotSize);
  const here = marks.filter((m) => m.kind === "here").length;
  if (here > 0) {
    canvas.setAttribute("aria-label", `${label}, ${here === 1 ? "someone" : here} here now`);
  }
  return canvas;
}

/**
 * Paint plot (px, py) with its north-west corner at (left, top), `t` pixels a tile, and give back
 * what it painted. `roof` is for a plot drawn beside the one the picture is about, which keeps its
 * roof as the map does.
 */
function paintPlot(
  ctx: CanvasRenderingContext2D,
  world: WorldSnapshot,
  plot: { px: number; py: number },
  left: number,
  top: number,
  t: number,
  o: { roof?: boolean } = {},
): PlotMark[] {
  const { size, tint, marks } = plotMarks(world, plot.px, plot.py, o);
  for (const mark of marks) {
    paint(ctx, mark, left + mark.x * t, top + mark.y * t, t);
    if (mark.kind === "ground" && tint && mark.x === size - 1 && mark.y === size - 1) {
      // The theme's tint goes over the whole ground once it's down, under everything else.
      ctx.fillStyle = tint;
      ctx.fillRect(left, top, size * t, size * t);
    }
  }
  return marks;
}

/**
 * A plot drawn with the plots around it, for the "Claim plot" picker: the neighbors under a wash
 * of paper and the plot itself ringed, so you see who you'd live beside. Past the world's edge is
 * plain paper.
 */
export function plotArea(
  world: WorldSnapshot,
  plot: { px: number; py: number },
  label: string,
  px: number,
): HTMLCanvasElement {
  const canvas = h("canvas", {
    class: "plot-thumb plot-area",
    attrs: { role: "img", "aria-label": label, width: px, height: px },
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(px * dpr);
  canvas.height = Math.round(px * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { plotSize, width, height } = world.config;
  const side = canvas.width / 3;
  const t = side / plotSize;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const at = { px: plot.px + dx, py: plot.py + dy };
      if (at.px < 0 || at.py < 0 || at.px >= width / plotSize || at.py >= height / plotSize) {
        continue;
      }
      const left = (dx + 1) * side;
      const top = (dy + 1) * side;
      paintPlot(ctx, world, at, left, top, t, { roof: dx !== 0 || dy !== 0 });
      if (dx !== 0 || dy !== 0) {
        ctx.fillStyle = alphaHex(PAPER, 0.45);
        ctx.fillRect(left, top, side, side);
      }
    }
  }
  const ring = Math.max(2, side * 0.06);
  ctx.strokeStyle = HEARTH_COLOR;
  ctx.lineWidth = ring;
  ctx.strokeRect(side + ring / 2, side + ring / 2, side - ring, side - ring);
  return canvas;
}
