import { bySquare, CROP_HEX, HEARTH_COLOR, plotOf, type Tile } from "@terrakin/sim";
import { BRAND_HEX, STONE_HI, STONE_LO, STRAW, STRAW_DEEP, WOOD } from "@terrakin/ui/brand";
import { type Camera, tileToScreen } from "../camera";
import { landNameAt } from "../lands";
import type { Mirror } from "../mirror";
import { CLAY, CLAY_DEEP, INK, PAPER, PAPER_EDGE, WOOD_DARK } from "./palette";

/** A building's footprint on screen, or undefined when it's off screen or unknown. */
export function tilesBox(tiles: readonly { x: number; y: number }[], cam: Camera) {
  if (tiles.length === 0) return undefined;
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  const half = cam.scale / 2;
  const a = tileToScreen(cam, Math.min(...xs), Math.min(...ys));
  const b = tileToScreen(cam, Math.max(...xs), Math.max(...ys));
  const left = a.sx - half;
  const top = a.sy - half;
  const w = b.sx + half - left;
  const h = b.sy + half - top;
  if (left > cam.width || top > cam.height || left + w < 0 || top + h < 0) return undefined;
  return { left, top, w, h };
}

type Box = NonNullable<ReturnType<typeof tilesBox>>;

/** Window glass by day. After dark the map's night pass lights each window (`civicLights`). */
const GLASS = "#cfe6ee";
/** A notice board's cork. */
const CORK = "#c9a06a";
/** The soft shadow a building throws on the plaza. */
const SHADOW = "rgba(74, 52, 28, 0.22)";

/**
 * The drawing's own units: a hall or a shop is drawn on a grid three across and two down, its
 * footprint's tiles, so `x(1.5)` is the middle and `y(2)` the front edge. A footprint clipped by
 * a small world squeezes the drawing to fit rather than cutting it.
 */
function grid(box: Box) {
  const ux = box.w / 3;
  const uy = box.h / 2;
  return {
    x: (f: number) => box.left + f * ux,
    y: (f: number) => box.top + f * uy,
    /** A length across, and one down. */
    dx: (f: number) => f * ux,
    dy: (f: number) => f * uy,
    /** A size that keeps its shape (a clock, a fruit). */
    u: Math.min(ux, uy),
  };
}

type Grid = ReturnType<typeof grid>;

/**
 * Where a building's windows and door glow after dark, in its own units: the night pass draws the
 * same warm pool there as it draws under a lantern, so the map's lit windows and the 3D view's
 * (`buildingGlows`) are the same windows.
 */
const LIGHTS: Record<"hall" | "shop", readonly (readonly [number, number])[]> = {
  hall: [
    [0.34, 1.22],
    [2.3, 1.22],
    [2.7, 1.22],
    [1.5, 1.38],
  ],
  shop: [
    [0.73, 1.4],
    [1.5, 1.4],
    [1.95, 1.34],
  ],
};

/** The screen points a building's windows glow from after dark. */
export function civicLights(kind: "hall" | "shop", box: Box): { x: number; y: number }[] {
  const g = grid(box);
  return LIGHTS[kind].map(([fx, fy]) => ({ x: g.x(fx), y: g.y(fy) }));
}

/** How far above its footprint a building's drawing reaches, so its label sits clear of it. */
export function civicRise(kind: "hall" | "shop", box: Box): number {
  return grid(box).dy(kind === "hall" ? 0.46 : 0.12);
}

/**
 * The Town Hall on each square: a storybook civic hall that fills its footprint. Stone steps up
 * to a gold door under a portico of four columns, a clay pediment with the town clock in it and a
 * flag on top, arched windows in the wings, and a notice board on the front wall beside the door.
 * On a land's square a small signboard in front names the land. Drawn under the residents, like a
 * hearth: nobody walks onto it once buildings are solid, so whoever stands beside it is in front.
 */
export function drawTownHall(ctx: CanvasRenderingContext2D, mirror: Mirror, cam: Camera) {
  // One per square: downtown's, and one on every land that is open (decision 0332).
  for (const tiles of bySquare(mirror.config, mirror.townHall)) {
    const box = tilesBox(tiles, cam);
    if (!box) continue;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    paintTownHall(ctx, grid(box), cam.scale);
    const land = landOf(mirror, tiles);
    if (land) paintLandSign(ctx, grid(box), cam.scale, land);
    ctx.restore();
  }
}

/** The name of the land a building's square is on, or undefined downtown. */
function landOf(mirror: Mirror, tiles: readonly Tile[]): string | undefined {
  const first = tiles[0];
  if (!first) return undefined;
  const { px, py } = plotOf(mirror.config, first.x, first.y);
  return landNameAt(mirror.lands, px, py);
}

function paintTownHall(ctx: CanvasRenderingContext2D, g: Grid, s: number) {
  const { x, y, dx, dy, u } = g;
  const line = Math.max(1, s / 30);
  // Its shadow on the plaza.
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(x(1.5), y(1.86), dx(1.5), dy(0.16), 0, 0, Math.PI * 2);
  ctx.fill();

  // The wings' low roof, behind everything in front of it.
  ctx.fillStyle = CLAY;
  ctx.beginPath();
  ctx.moveTo(x(0.04), y(0.84));
  ctx.lineTo(x(0.3), y(0.5));
  ctx.lineTo(x(2.7), y(0.5));
  ctx.lineTo(x(2.96), y(0.84));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(43, 38, 32, 0.18)";
  ctx.lineWidth = line;
  ctx.beginPath();
  for (const f of [0.6, 0.72]) {
    const t = (0.84 - f) / 0.34;
    ctx.moveTo(x(0.04 + 0.26 * t), y(f));
    ctx.lineTo(x(2.96 - 0.26 * t), y(f));
  }
  ctx.stroke();

  // The walls, on a stone plinth.
  ctx.fillStyle = PAPER;
  ctx.fillRect(x(0.1), y(0.84), dx(2.8), dy(0.8));
  ctx.strokeStyle = PAPER_EDGE;
  ctx.strokeRect(x(0.1) + 0.5, y(0.84) + 0.5, dx(2.8) - 1, dy(0.8) - 1);
  ctx.fillStyle = STONE_HI;
  ctx.fillRect(x(0.06), y(1.6), dx(2.88), dy(0.14));
  ctx.fillStyle = STONE_LO;
  ctx.fillRect(x(0.06), y(1.71), dx(2.88), dy(0.03));
  // The portico's shaded back wall, between the wings.
  ctx.fillStyle = PAPER_EDGE;
  ctx.fillRect(x(0.86), y(0.86), dx(1.28), dy(0.74));

  // Arched windows in the wings: one on the left beside the notice board, two on the right.
  for (const fx of [0.34, 2.3, 2.7]) archedWindow(ctx, g, fx, 1.0, 0.22, 0.46, line);
  noticeBoard(ctx, g, s);

  // The door: gold, arched, in a dark wood frame, between the middle columns.
  ctx.fillStyle = WOOD_DARK;
  archPath(ctx, x(1.33), y(1.1), dx(0.34), dy(0.5));
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.sun;
  archPath(ctx, x(1.37), y(1.14), dx(0.26), dy(0.46));
  ctx.fill();
  ctx.strokeStyle = "rgba(143, 61, 32, 0.45)";
  ctx.beginPath();
  ctx.moveTo(x(1.5), y(1.2));
  ctx.lineTo(x(1.5), y(1.6));
  ctx.stroke();

  // Four columns with their capitals and bases.
  for (const fx of [0.98, 1.29, 1.71, 2.02]) {
    ctx.fillStyle = "#e8dfcc";
    ctx.fillRect(x(fx - 0.055), y(0.9), dx(0.11), dy(0.7));
    ctx.fillStyle = "rgba(43, 38, 32, 0.1)";
    ctx.fillRect(x(fx + 0.02), y(0.9), dx(0.035), dy(0.7));
    ctx.fillStyle = PAPER;
    ctx.fillRect(x(fx - 0.08), y(0.88), dx(0.16), dy(0.05));
    ctx.fillRect(x(fx - 0.08), y(1.56), dx(0.16), dy(0.05));
  }

  // The entablature over the columns and walls.
  ctx.fillStyle = CLAY_DEEP;
  ctx.fillRect(x(0.04), y(0.79), dx(2.92), dy(0.08));
  ctx.fillStyle = PAPER_EDGE;
  ctx.fillRect(x(0.1), y(0.87), dx(2.8), dy(0.025));

  // The pediment, with the town clock in it.
  ctx.fillStyle = HEARTH_COLOR;
  ctx.beginPath();
  ctx.moveTo(x(0.76), y(0.81));
  ctx.lineTo(x(1.5), y(0.2));
  ctx.lineTo(x(2.24), y(0.81));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.moveTo(x(0.94), y(0.76));
  ctx.lineTo(x(1.5), y(0.3));
  ctx.lineTo(x(2.06), y(0.76));
  ctx.closePath();
  ctx.fill();
  const cx = x(1.5);
  const cy = y(0.57);
  const r = u * 0.15;
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath();
  // Ten past ten, as clocks in shop windows stand.
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - r * 0.4, cy - r * 0.32);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * 0.52, cy - r * 0.38);
  ctx.stroke();

  // Stone steps up to the door, toward whoever looks.
  const steps: readonly [number, number, number][] = [
    [1.08, 1.6, 1.68],
    [1.22, 1.68, 1.78],
    [1.36, 1.78, 1.9],
  ];
  for (const [wide, top, bottom] of steps) {
    ctx.fillStyle = STONE_HI;
    ctx.fillRect(x(1.5 - wide / 2), y(top), dx(wide), dy(bottom - top));
    ctx.fillStyle = STONE_LO;
    ctx.fillRect(
      x(1.5 - wide / 2),
      y(bottom) - Math.max(1, dy(0.025)),
      dx(wide),
      Math.max(1, dy(0.025)),
    );
  }

  // The flag on its pole over the pediment.
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, s / 30);
  ctx.beginPath();
  ctx.moveTo(x(1.5), y(0.22));
  ctx.lineTo(x(1.5), y(-0.44));
  ctx.stroke();
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.arc(x(1.5), y(-0.46), Math.max(1.2, u * 0.035), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.moss;
  ctx.beginPath();
  ctx.moveTo(x(1.5), y(-0.42));
  ctx.quadraticCurveTo(x(1.62), y(-0.48), x(1.78), y(-0.4));
  ctx.lineTo(x(1.78), y(-0.2));
  ctx.quadraticCurveTo(x(1.62), y(-0.28), x(1.5), y(-0.22));
  ctx.closePath();
  ctx.fill();
}

/** A rectangle with a round top: a door or a window's arch. */
function archPath(ctx: CanvasRenderingContext2D, left: number, top: number, w: number, h: number) {
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, [w / 2, w / 2, 0, 0]);
}

/** A tall arched window centered on `fx`: a stone surround, the glass, its bars, and a sill. */
function archedWindow(
  ctx: CanvasRenderingContext2D,
  g: Grid,
  fx: number,
  fy: number,
  wide: number,
  tall: number,
  line: number,
) {
  const { x, y, dx, dy } = g;
  ctx.fillStyle = STONE_HI;
  archPath(ctx, x(fx - wide / 2 - 0.03), y(fy - 0.03), dx(wide + 0.06), dy(tall + 0.04));
  ctx.fill();
  ctx.fillStyle = GLASS;
  archPath(ctx, x(fx - wide / 2), y(fy), dx(wide), dy(tall));
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillRect(x(fx - wide / 2 + 0.03), y(fy + 0.12), dx(0.04), dy(tall * 0.5));
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.moveTo(x(fx), y(fy + 0.04));
  ctx.lineTo(x(fx), y(fy + tall));
  ctx.moveTo(x(fx - wide / 2), y(fy + tall * 0.55));
  ctx.lineTo(x(fx + wide / 2), y(fy + tall * 0.55));
  ctx.stroke();
  ctx.fillStyle = STONE_LO;
  ctx.fillRect(x(fx - wide / 2 - 0.05), y(fy + tall), dx(wide + 0.1), dy(0.04));
}

/** The notice board on the hall's front wall: cork in a wood frame, with notes pinned up. */
function noticeBoard(ctx: CanvasRenderingContext2D, g: Grid, s: number) {
  const { x, y, dx, dy, u } = g;
  ctx.fillStyle = WOOD_DARK;
  ctx.beginPath();
  ctx.roundRect(x(0.52), y(1.04), dx(0.3), dy(0.36), Math.max(1, s * 0.02));
  ctx.fill();
  ctx.fillStyle = CORK;
  ctx.fillRect(x(0.545), y(1.065), dx(0.25), dy(0.31));
  const notes: readonly [number, number, number, number, string][] = [
    [0.56, 1.08, 0.1, 0.12, PAPER],
    [0.68, 1.1, 0.1, 0.1, BRAND_HEX.sun],
    [0.58, 1.23, 0.09, 0.11, BRAND_HEX.mossLight],
    [0.69, 1.23, 0.09, 0.12, PAPER],
  ];
  for (const [fx, fy, fw, fh, fill] of notes) {
    ctx.fillStyle = fill;
    ctx.fillRect(x(fx), y(fy), dx(fw), dy(fh));
    ctx.fillStyle = CLAY;
    ctx.beginPath();
    ctx.arc(x(fx + fw / 2), y(fy + 0.015), Math.max(0.8, u * 0.018), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A land's name on a small signboard on two posts in front of its hall, left of the steps. The
 * name is the land's, set when it opened; it goes on the canvas as text and nothing else.
 */
function paintLandSign(ctx: CanvasRenderingContext2D, g: Grid, s: number, name: string) {
  const { x, y, dy } = g;
  const size = Math.max(9, Math.round(s * 0.3));
  ctx.font = `italic 600 ${size}px "Fraunces Variable", Georgia, serif`;
  const textW = ctx.measureText(name).width;
  const w = textW + size * 1.1;
  const h = size * 1.6;
  const cx = x(0.45);
  const top = y(1.98);
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1.5, s / 16);
  ctx.beginPath();
  for (const f of [-0.32, 0.32]) {
    ctx.moveTo(cx + w * f, top + h * 0.5);
    ctx.lineTo(cx + w * f, top + h + dy(0.14));
  }
  ctx.stroke();
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = Math.max(1, s / 22);
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, top, w, h, h * 0.25);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, cx, top + h / 2 + 0.5);
}

/**
 * The town shop (RFC 0008) on each square: a storybook shop that fills its footprint. Cream walls
 * under a moss roof, a striped awning over a window display of jars and loaves, a green door, a
 * sign hanging from a bracket, crates and a basket of produce out front, and beside it a small
 * market stall under a striped canopy with its counter heaped. Like the Town Hall, it's drawn
 * under the residents.
 */
export function drawShop(ctx: CanvasRenderingContext2D, mirror: Mirror, cam: Camera) {
  for (const tiles of bySquare(mirror.config, mirror.shop)) {
    const box = tilesBox(tiles, cam);
    if (!box) continue;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    paintShop(ctx, grid(box), cam.scale);
    ctx.restore();
  }
}

function paintShop(ctx: CanvasRenderingContext2D, g: Grid, s: number) {
  const { x, y, dx, dy } = g;
  const line = Math.max(1, s / 30);
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(x(1.5), y(1.88), dx(1.5), dy(0.15), 0, 0, Math.PI * 2);
  ctx.fill();

  // A chimney, then the roof over it.
  ctx.fillStyle = CLAY;
  ctx.fillRect(x(1.62), y(-0.04), dx(0.16), dy(0.36));
  ctx.fillStyle = CLAY_DEEP;
  ctx.fillRect(x(1.6), y(-0.08), dx(0.2), dy(0.06));
  ctx.fillStyle = BRAND_HEX.moss;
  ctx.beginPath();
  ctx.moveTo(x(0.12), y(0.74));
  ctx.lineTo(x(0.36), y(0.14));
  ctx.lineTo(x(1.92), y(0.14));
  ctx.lineTo(x(2.16), y(0.74));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(43, 38, 32, 0.22)";
  ctx.lineWidth = line;
  ctx.beginPath();
  for (const t of [0.33, 0.66]) {
    const fy = 0.14 + 0.6 * t;
    ctx.moveTo(x(0.36 - 0.24 * t), y(fy));
    ctx.lineTo(x(1.92 + 0.24 * t), y(fy));
  }
  ctx.stroke();
  ctx.fillStyle = BRAND_HEX.mossLight;
  ctx.fillRect(x(0.36), y(0.12), dx(1.56), dy(0.05));

  // Walls, on a stone footing.
  ctx.fillStyle = PAPER;
  ctx.fillRect(x(0.2), y(0.72), dx(1.88), dy(1.16));
  ctx.strokeStyle = PAPER_EDGE;
  ctx.strokeRect(x(0.2) + 0.5, y(0.72) + 0.5, dx(1.88) - 1, dy(1.16) - 1);
  ctx.fillStyle = STONE_HI;
  ctx.fillRect(x(0.2), y(1.78), dx(1.88), dy(0.1));

  // The window display: two shelves, jars above, loaves and fruit below.
  ctx.fillStyle = PAPER_EDGE;
  ctx.fillRect(x(0.3), y(1.1), dx(0.86), dy(0.58));
  ctx.fillStyle = GLASS;
  ctx.fillRect(x(0.34), y(1.14), dx(0.78), dy(0.5));
  ctx.fillStyle = WOOD;
  ctx.fillRect(x(0.34), y(1.37), dx(0.78), dy(0.03));
  [BRAND_HEX.sun, CLAY, BRAND_HEX.moss, CROP_HEX.blueberry].forEach((fill, i) => {
    const jx = x(0.43 + i * 0.18);
    const jw = dx(0.1);
    const jh = dy(0.15);
    const base = y(1.37);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(jx - jw / 2, base - jh, jw, jh, jw * 0.25);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.fillRect(jx - jw * 0.3, base - jh * 0.62, jw * 0.6, jh * 0.28);
    ctx.fillStyle = STRAW_DEEP;
    ctx.fillRect(jx - jw * 0.55, base - jh * 1.12, jw * 1.1, jh * 0.16);
  });
  for (const fx of [0.46, 0.66]) {
    ctx.fillStyle = "#c98a46";
    ctx.beginPath();
    ctx.ellipse(x(fx), y(1.57), dx(0.08), dy(0.05), 0, Math.PI, 0);
    ctx.fill();
  }
  [CROP_HEX.apple, CROP_HEX.lemon, CROP_HEX.peach].forEach((fill, i) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x(0.84 + i * 0.09), y(1.58), g.u * 0.045, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.beginPath();
  ctx.moveTo(x(0.38), y(1.36));
  ctx.lineTo(x(0.56), y(1.16));
  ctx.lineTo(x(0.64), y(1.16));
  ctx.lineTo(x(0.46), y(1.36));
  ctx.fill();
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x(0.28), y(1.66), dx(0.9), dy(0.04));

  // The small window right of the door, with a box of flowers.
  ctx.fillStyle = PAPER_EDGE;
  ctx.fillRect(x(1.82), y(1.12), dx(0.26), dy(0.38));
  ctx.fillStyle = GLASS;
  ctx.fillRect(x(1.85), y(1.15), dx(0.2), dy(0.32));
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.moveTo(x(1.95), y(1.15));
  ctx.lineTo(x(1.95), y(1.47));
  ctx.stroke();
  ctx.fillStyle = WOOD;
  ctx.fillRect(x(1.8), y(1.5), dx(0.3), dy(0.07));
  ctx.fillStyle = CROP_HEX.flower;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x(1.85 + i * 0.1), y(1.5), g.u * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  // The door, with a round window and a gold knob, over a stone step.
  ctx.fillStyle = STONE_HI;
  ctx.beginPath();
  ctx.roundRect(x(1.28), y(1.82), dx(0.44), dy(0.08), 2);
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.moss;
  archPath(ctx, x(1.35), y(1.12), dx(0.3), dy(0.7));
  ctx.fill();
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.arc(x(1.5), y(1.3), g.u * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.arc(x(1.6), y(1.52), Math.max(1.2, g.u * 0.03), 0, Math.PI * 2);
  ctx.fill();

  // The striped awning, scalloped along its edge, and its shade on the wall.
  const awnL = x(0.14);
  const awnR = x(2.14);
  const awnTop = y(0.78);
  const awnBottom = y(1.0);
  const stripes = 9;
  const sw = (awnR - awnL) / stripes;
  ctx.fillStyle = "rgba(74, 52, 28, 0.16)";
  ctx.fillRect(x(0.2), awnBottom, dx(1.88), sw * 0.7);
  stripedCanopy(ctx, awnL, awnTop, awnR, awnBottom, stripes, CLAY, BRAND_HEX.paper2, line);
  ctx.fillStyle = CLAY_DEEP;
  ctx.fillRect(awnL, awnTop - dy(0.03), awnR - awnL, dy(0.045));

  // Crates and a basket of produce out front, under the window display.
  crate(ctx, g, 0.3, CROP_HEX.tomato);
  crate(ctx, g, 0.66, CROP_HEX.lemon);
  ctx.fillStyle = STRAW_DEEP;
  ctx.beginPath();
  ctx.ellipse(x(1.13), y(1.8), dx(0.11), dy(0.09), 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = CROP_HEX.apple;
  for (const [fx, fy] of [
    [1.08, 1.78],
    [1.18, 1.78],
    [1.13, 1.74],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x(fx), y(fy), g.u * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = STRAW;
  ctx.fillRect(x(1.02), y(1.79), dx(0.22), dy(0.025));

  // The sign hanging from a bracket on the left corner: a jar on a paper board.
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, s / 26);
  ctx.beginPath();
  ctx.moveTo(x(0.2), y(1.04));
  ctx.lineTo(x(0.02), y(1.04));
  ctx.moveTo(x(0.06), y(1.04));
  ctx.lineTo(x(0.06), y(1.1));
  ctx.stroke();
  const signW = dx(0.26);
  const signH = dy(0.22);
  const signX = x(0.06) - signW / 2;
  const signY = y(1.1);
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = Math.max(1, s / 22);
  ctx.beginPath();
  ctx.roundRect(signX, signY, signW, signH, signW * 0.15);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.roundRect(
    signX + signW * 0.32,
    signY + signH * 0.32,
    signW * 0.36,
    signH * 0.48,
    signW * 0.08,
  );
  ctx.fill();
  ctx.fillStyle = CLAY;
  ctx.fillRect(signX + signW * 0.28, signY + signH * 0.22, signW * 0.44, signH * 0.14);

  marketStall(ctx, g, line);
}

/** A run of stripes from `left` to `right`, each with a round scallop under it. */
function stripedCanopy(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  right: number,
  bottom: number,
  stripes: number,
  a: string,
  b: string,
  line: number,
) {
  const sw = (right - left) / stripes;
  ctx.strokeStyle = "rgba(143, 61, 32, 0.45)";
  ctx.lineWidth = line;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? a : b;
    ctx.beginPath();
    ctx.moveTo(left + i * sw, top);
    ctx.lineTo(left + (i + 1) * sw, top);
    ctx.lineTo(left + (i + 1) * sw, bottom);
    ctx.arc(left + (i + 0.5) * sw, bottom, sw / 2, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** A slatted wooden crate standing at `fx`, heaped with fruit of one color. */
function crate(ctx: CanvasRenderingContext2D, g: Grid, fx: number, fruit: string) {
  const { x, y, dx, dy, u } = g;
  const w = 0.32;
  ctx.fillStyle = fruit;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(x(fx + 0.06 + i * 0.065), y(i % 2 === 0 ? 1.66 : 1.63), u * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = WOOD;
  ctx.fillRect(x(fx), y(1.66), dx(w), dy(0.22));
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x(fx), y(1.73), dx(w), dy(0.02));
  ctx.fillRect(x(fx), y(1.8), dx(w), dy(0.02));
  ctx.fillRect(x(fx), y(1.66), dx(0.025), dy(0.22));
  ctx.fillRect(x(fx + w - 0.025), y(1.66), dx(0.025), dy(0.22));
}

/** The market stall beside the shop: a moss and cream canopy on two posts over a heaped counter. */
function marketStall(ctx: CanvasRenderingContext2D, g: Grid, line: number) {
  const { x, y, dx, dy, u } = g;
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1.5, dx(0.04));
  ctx.beginPath();
  for (const fx of [2.26, 2.9]) {
    ctx.moveTo(x(fx), y(0.96));
    ctx.lineTo(x(fx), y(1.86));
  }
  ctx.stroke();
  // Its counter, heaped with what's in season.
  const heaps: readonly [number, string][] = [
    [2.34, CROP_HEX.pumpkin],
    [2.5, CROP_HEX.carrot],
    [2.66, CROP_HEX.cabbage],
    [2.82, CROP_HEX.grape],
  ];
  for (const [fx, fill] of heaps) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x(fx), y(1.48), dx(0.07), dy(0.07), 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x(fx), y(1.44), u * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = WOOD;
  ctx.fillRect(x(2.2), y(1.48), dx(0.76), dy(0.4));
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x(2.2), y(1.48), dx(0.76), dy(0.04));
  ctx.fillStyle = "rgba(43, 38, 32, 0.18)";
  for (const fx of [2.38, 2.58, 2.78]) ctx.fillRect(x(fx), y(1.53), dx(0.015), dy(0.33));
  // A price board on the counter's front.
  ctx.fillStyle = PAPER;
  ctx.fillRect(x(2.46), y(1.6), dx(0.24), dy(0.12));
  ctx.fillStyle = CLAY;
  ctx.fillRect(x(2.5), y(1.645), dx(0.16), dy(0.03));
  stripedCanopy(ctx, x(2.18), y(0.9), x(2.98), y(1.08), 5, BRAND_HEX.moss, BRAND_HEX.paper2, line);
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x(2.18), y(0.88), dx(0.8), dy(0.04));
}
