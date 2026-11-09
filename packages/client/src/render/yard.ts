/**
 * The wild yard on the map (RFC 0052): what `wild-yard.ts` says grows on each wild tile, and each
 * slot's feature, gathered into a few paths while the ground is walked and painted in one go after
 * it, under the pickups and everything that stands. Drawing only; nothing here is tapped.
 */
import { insetOf, type Season, tileKey } from "@terrakin/sim";
import { withAlpha } from "@terrakin/ui/looks";
import { type Camera, tileToScreen } from "../camera";
import type { Mirror } from "../mirror";
import {
  canopyTone,
  featureOn,
  type PlotFeature,
  YARD_LOOK,
  type YardGrowth,
  yardTone,
} from "../wild-yard";

/** Where a tile falls on the screen, in whole pixels. */
interface Cell {
  left: number;
  top: number;
  w: number;
  h: number;
}

/** A feature on screen, with the cells it covers. */
interface ShownFeature {
  feature: PlotFeature;
  cells: Cell[];
}

/** The shadow everything standing in the yard casts, south and east of it. */
const SHADE = "rgba(43, 38, 32, 0.16)";

export class YardPainter {
  /** Grass tufts and flower heads go into the ground pass's own paths, so they paint with it. */
  constructor(
    private readonly tufts: Path2D,
    private readonly flowers: [Path2D, Path2D],
  ) {}

  readonly #shadow = new Path2D();
  readonly #bushes = new Path2D();
  readonly #bushLight = new Path2D();
  readonly #trees: { cx: number; cy: number; r: number; tone: 0 | 1 | 2 }[] = [];
  readonly #features: ShownFeature[] = [];
  /** The tiles a feature covers on screen, which grow nothing else. */
  readonly featureTiles = new Set<string>();

  /**
   * The features of every slot from (px0, py0) to (px1, py1) that draw whole on wild ground. Call
   * before the ground pass, so the tiles they cover grow nothing of their own.
   */
  features(
    mirror: Mirror,
    cam: Camera,
    slots: { px0: number; py0: number; px1: number; py1: number },
    season: Season | undefined,
  ) {
    const { px0, py0, px1, py1 } = slots;
    const S = mirror.config.plotSize;
    const ring = insetOf(mirror.config);
    const half = cam.scale / 2;
    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const f = featureOn(px, py, S, ring, (x, y) => mirror.wildAt(x, y) === "yard");
        if (!f) continue;
        const cells = f.world.map((t) => {
          this.featureTiles.add(tileKey(t.x, t.y));
          const { sx, sy } = tileToScreen(cam, t.x, t.y);
          const left = Math.round(sx - half);
          const top = Math.round(sy - half);
          return {
            left,
            top,
            w: Math.round(sx + half) - left,
            h: Math.round(sy + half) - top,
          };
        });
        this.#features.push({ feature: f, cells });
        // A flowering bank grows in with the ground's own tufts and flowers, painted with them.
        if (f.kind === "flower_bank") this.#bank(cells, cam.scale, season);
      }
    }
  }

  /** A flowering bank's tiles: tufts, and in any season but winter thick clumps of both tones. */
  #bank(cells: readonly Cell[], scale: number, season: Season | undefined) {
    for (const [i, c] of cells.entries()) {
      this.#tuft(c.left + c.w * 0.3, c.top + c.h * 0.8, c);
      if (season === "winter") continue;
      this.#clump(c.left + c.w * 0.5, c.top + c.h * 0.45, 4, 0, scale);
      this.#clump(c.left + c.w * 0.25, c.top + c.h * 0.2, 3, (i & 1) as 0 | 1, scale);
      this.#clump(c.left + c.w * 0.75, c.top + c.h * 0.7, 3, 1, scale);
    }
  }

  /** One wild tile's growth, at its cell on screen. */
  grow(g: YardGrowth, c: Cell, scale: number) {
    const x = c.left + c.w * g.fx;
    const y = c.top + c.h * g.fy;
    switch (g.kind) {
      case "grass":
        this.#tuft(x - c.w * 0.14, y, c);
        this.#tuft(x + c.w * 0.12, y + c.h * 0.1, c);
        return;
      case "flowers":
        this.#clump(x, y, g.count, g.tone, scale);
        return;
      case "bush": {
        const r = g.size * scale;
        this.#shadow.moveTo(x + r * 1.15, y + r * 0.35);
        this.#shadow.ellipse(x + r * 0.15, y + r * 0.35, r, r * 0.6, 0, 0, Math.PI * 2);
        this.#bushes.moveTo(x + r, y);
        this.#bushes.arc(x, y, r, 0, Math.PI * 2);
        this.#bushLight.moveTo(x - r * 0.05, y - r * 0.3);
        this.#bushLight.arc(x - r * 0.3, y - r * 0.3, r * 0.42, 0, Math.PI * 2);
        return;
      }
      case "tree": {
        const r = g.size * scale;
        this.#shadow.moveTo(x + r * 1.3, y + r * 0.45);
        this.#shadow.ellipse(x + r * 0.3, y + r * 0.45, r, r * 0.62, 0, 0, Math.PI * 2);
        // A crown in three lobes, so it reads as leaves from above rather than a ball.
        this.#trees.push({ cx: x, cy: y + r * 0.1, r: r * 0.86, tone: g.tone });
        this.#trees.push({ cx: x - r * 0.38, cy: y - r * 0.3, r: r * 0.58, tone: g.tone });
        this.#trees.push({ cx: x + r * 0.36, cy: y - r * 0.22, r: r * 0.55, tone: g.tone });
      }
    }
  }

  /** A tuft of grass, three blades, as the map's own tufts are drawn. */
  #tuft(bx: number, by: number, c: Cell) {
    const { w, h } = c;
    this.tufts.moveTo(bx - w * 0.07, by);
    this.tufts.lineTo(bx - w * 0.1, by - h * 0.12);
    this.tufts.moveTo(bx, by);
    this.tufts.lineTo(bx, by - h * 0.17);
    this.tufts.moveTo(bx + w * 0.07, by);
    this.tufts.lineTo(bx + w * 0.11, by - h * 0.11);
  }

  /** A clump of `count` flower heads round (x, y). */
  #clump(x: number, y: number, count: number, tone: 0 | 1, scale: number) {
    const path = this.flowers[tone];
    const r = scale * 0.055;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + tone;
      const d = scale * (i === 0 ? 0 : 0.13);
      const fx = x + Math.cos(a) * d;
      const fy = y + Math.sin(a) * d * 0.8;
      path.moveTo(fx + r, fy);
      path.arc(fx, fy, r, 0, Math.PI * 2);
    }
  }

  /** Paint the bushes, trees, and features gathered, in `season`. */
  paint(ctx: CanvasRenderingContext2D, scale: number, season: Season | undefined) {
    // Features lie or stand in the yard: their flowers and stones first, the old tree with the rest.
    const winter = season === "winter";
    const stones = new Path2D();
    const mossy = new Path2D();
    for (const { feature, cells } of this.#features) {
      if (feature.kind === "flower_bank") continue;
      if (feature.kind === "stone_wall") {
        // A dry stone wall: two or three stones a tile, along the side it runs by.
        const across = feature.side === "n" || feature.side === "s";
        for (const c of cells) {
          for (let i = 0; i < 3; i++) {
            const along = 0.18 + i * 0.32;
            const cx = c.left + c.w * (across ? along : 0.5);
            const cy = c.top + c.h * (across ? 0.5 : along);
            const rx = scale * (across ? 0.17 : 0.13);
            const ry = scale * (across ? 0.13 : 0.17);
            this.#shadow.moveTo(cx + rx * 1.2, cy + ry * 0.4);
            this.#shadow.ellipse(cx + rx * 0.2, cy + ry * 0.4, rx, ry, 0, 0, Math.PI * 2);
            stones.moveTo(cx + rx, cy);
            stones.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            if (i === 1) {
              mossy.moveTo(cx + rx * 0.5, cy - ry * 0.3);
              mossy.ellipse(cx, cy - ry * 0.3, rx * 0.5, ry * 0.35, 0, 0, Math.PI * 2);
            }
          }
        }
      } else if (feature.kind === "boulder") {
        const box = bounds(cells);
        const cx = (box.x0 + box.x1) / 2;
        const cy = (box.y0 + box.y1) / 2;
        const rx = (box.x1 - box.x0) * 0.42;
        const ry = (box.y1 - box.y0) * 0.38;
        this.#shadow.moveTo(cx + rx * 1.25, cy + ry * 0.35);
        this.#shadow.ellipse(cx + rx * 0.25, cy + ry * 0.35, rx, ry, 0, 0, Math.PI * 2);
        stones.moveTo(cx + rx, cy);
        stones.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        mossy.moveTo(cx + rx * 0.1, cy - ry * 0.35);
        mossy.ellipse(cx - rx * 0.25, cy - ry * 0.35, rx * 0.35, ry * 0.3, 0, 0, Math.PI * 2);
      } else {
        // An old tree, two tiles across, its canopy in lobes.
        const box = bounds(cells);
        const cx = (box.x0 + box.x1) / 2;
        const cy = (box.y0 + box.y1) / 2;
        const r = (box.x1 - box.x0) * 0.4;
        this.#shadow.moveTo(cx + r * 1.35, cy + r * 0.5);
        this.#shadow.ellipse(cx + r * 0.35, cy + r * 0.5, r * 1.05, r * 0.68, 0, 0, Math.PI * 2);
        this.#trees.push({ cx, cy, r: r * 1.05, tone: 2 });
        this.#trees.push({ cx: cx - r * 0.42, cy: cy - r * 0.18, r: r * 0.62, tone: 0 });
        this.#trees.push({ cx: cx + r * 0.38, cy: cy + r * 0.12, r: r * 0.6, tone: 2 });
      }
    }
    ctx.fillStyle = SHADE;
    ctx.fill(this.#shadow);
    const leaf = yardTone(YARD_LOOK.bush, season);
    ctx.fillStyle = leaf;
    ctx.fill(this.#bushes);
    ctx.fillStyle = withAlpha("#ffffff", 0.14);
    ctx.fill(this.#bushLight);
    const grey = yardTone(YARD_LOOK.stone, season);
    ctx.fillStyle = grey;
    ctx.fill(stones);
    ctx.lineWidth = Math.max(1, scale / 28);
    ctx.strokeStyle = "rgba(60, 56, 48, 0.35)";
    ctx.stroke(stones);
    ctx.fillStyle = winter ? withAlpha("#ffffff", 0.7) : yardTone(YARD_LOOK.moss, season);
    ctx.fill(mossy);
    // Every tree's lobes: canopies by tone, then a darker rim on each one's south side and light
    // on top, a few fills for the whole screen however many trees stand on it.
    const crowns: [Path2D, Path2D, Path2D] = [new Path2D(), new Path2D(), new Path2D()];
    const rims = new Path2D();
    const tops = new Path2D();
    for (const t of this.#trees) {
      crowns[t.tone].moveTo(t.cx + t.r, t.cy);
      crowns[t.tone].arc(t.cx, t.cy, t.r, 0, Math.PI * 2);
      const rx = t.cx + t.r * 0.12;
      const ry = t.cy + t.r * 0.16;
      rims.moveTo(rx + t.r * 0.86, ry);
      rims.arc(rx, ry, t.r * 0.86, 0, Math.PI);
      rims.closePath();
      const lx = t.cx - t.r * 0.3;
      const ly = t.cy - t.r * 0.32;
      tops.moveTo(lx + t.r * 0.42, ly);
      tops.arc(lx, ly, t.r * 0.42, 0, Math.PI * 2);
    }
    for (const tone of [0, 1, 2] as const) {
      ctx.fillStyle = canopyTone(tone, season);
      ctx.fill(crowns[tone]);
    }
    ctx.fillStyle = "rgba(30, 40, 20, 0.16)";
    ctx.fill(rims);
    ctx.fillStyle = winter ? withAlpha("#ffffff", 0.5) : withAlpha("#ffffff", 0.16);
    ctx.fill(tops);
  }
}

/** The screen box around a feature's cells. */
function bounds(cells: readonly Cell[]) {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const c of cells) {
    x0 = Math.min(x0, c.left);
    y0 = Math.min(y0, c.top);
    x1 = Math.max(x1, c.left + c.w);
    y1 = Math.max(y1, c.top + c.h);
  }
  return { x0, y0, x1, y1 };
}
