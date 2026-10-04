import { type BlockKind, plotKey, type ResidentColor, type ResidentShape } from "@terrakin/sim";
import { type Camera, tileToScreen } from "./camera";
import type { Mirror } from "./mirror";
import { nightAmount } from "./time";

// Storybook palette. Matches the tokens in style.css.
const PAPER = "#fffaf0";
const PAPER_EDGE = "#ecdcc0";
const INK = "#2b2620";
const CLAY = "#b4532f";
const CLAY_DEEP = "#8f3d20";

const BLOCK_COLORS: Record<BlockKind, string> = {
  wood: "#b8834f",
  stone: "#a39d93",
  glass: "#bfe0ea",
  leaf: "#6b9a4a",
};

export function blockColor(block: BlockKind): string {
  return BLOCK_COLORS[block];
}

export const HEARTH_COLOR = "#d9653a";

export const RESIDENT_COLOR_HEX: Record<ResidentColor, string> = {
  sun: "#f2b84b",
  sky: "#7cb9dd",
  leaf: "#86b65f",
  rose: "#ea8a9d",
  plum: "#a98bd8",
  sand: "#e2c993",
  coal: "#4a443d",
  snow: "#fbf7ee",
};

/** Soft meadow and sandy Commons tones. Picked per tile by a fixed hash, so the ground has texture. */
const GRASS = ["#a5c682", "#a1c27d", "#a9c986", "#9dbe79"];
const COMMONS = ["#efdcab", "#ebd7a4", "#f2e1b3", "#e8d39f"];
const OUTSIDE = "#e6d6b6";

/** Cheap integer hash for visual variety only. Not game state: the sim never sees it. */
function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Stable hue per owner so neighbors' plots are easy to tell apart.
function ownerHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function residentPath(
  ctx: CanvasRenderingContext2D,
  shape: ResidentShape,
  x: number,
  y: number,
  r: number,
) {
  ctx.beginPath();
  if (shape === "square") ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.35);
  else if (shape === "diamond") {
    const d = r * 1.22;
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d, y);
    ctx.closePath();
  } else ctx.arc(x, y, r, 0, Math.PI * 2);
}

const labelWidths = new Map<string, number>();
function labelWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`;
  let w = labelWidths.get(key);
  if (w === undefined) {
    if (labelWidths.size > 400) labelWidths.clear();
    w = ctx.measureText(text).width;
    labelWidths.set(key, w);
  }
  return w;
}

export interface RenderState {
  mirror: Mirror;
  me: string | undefined;
  cam: Camera;
  buildMode: boolean;
  /** Phase of the day, 0 to 1. Absent when the server gave no time anchor. */
  dayPhase?: number;
}

export function render(
  ctx: CanvasRenderingContext2D,
  { mirror, me, cam, buildMode, dayPhase }: RenderState,
) {
  const { width, height, scale } = cam;
  const { config, commons } = mirror;
  const S = config.plotSize;
  ctx.fillStyle = OUTSIDE;
  ctx.fillRect(0, 0, width, height);

  // Visible tile range.
  const x0 = Math.max(0, Math.floor(cam.cx - width / scale / 2) - 1);
  const x1 = Math.min(config.width - 1, Math.ceil(cam.cx + width / scale / 2) + 1);
  const y0 = Math.max(0, Math.floor(cam.cy - height / scale / 2) - 1);
  const y1 = Math.min(config.height - 1, Math.ceil(cam.cy + height / scale / 2) + 1);
  const half = scale / 2;

  // ---- ground: one fillRect per tile, edges rounded so neighbors share pixels (no seams) ----
  const tufts = new Path2D();
  const flowers: [Path2D, Path2D] = [new Path2D(), new Path2D()];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const { sx, sy } = tileToScreen(cam, x, y);
      const left = Math.round(sx - half);
      const top = Math.round(sy - half);
      const w = Math.round(sx + half) - left;
      const h = Math.round(sy + half) - top;
      const inCommons = Math.floor(x / S) === commons.px && Math.floor(y / S) === commons.py;
      const n = tileHash(x, y);
      ctx.fillStyle = (inCommons ? COMMONS : GRASS)[n & 3] as string;
      ctx.fillRect(left, top, w, h);
      if (inCommons) continue;
      const deco = (n >>> 4) % 17;
      if (deco === 0 || deco === 7) {
        // A little tuft of grass.
        const bx = left + w * (0.3 + ((n >>> 9) & 7) / 20);
        const by = top + h * 0.72;
        tufts.moveTo(bx - w * 0.08, by);
        tufts.lineTo(bx - w * 0.12, by - h * 0.14);
        tufts.moveTo(bx, by);
        tufts.lineTo(bx, by - h * 0.2);
        tufts.moveTo(bx + w * 0.08, by);
        tufts.lineTo(bx + w * 0.13, by - h * 0.13);
      } else if (deco === 3) {
        const fx = left + w * (0.25 + ((n >>> 12) & 7) / 14);
        const fy = top + h * (0.25 + ((n >>> 15) & 7) / 14);
        const path = flowers[(n >>> 20) & 1] as Path2D;
        path.moveTo(fx + scale * 0.06, fy);
        path.arc(fx, fy, scale * 0.06, 0, Math.PI * 2);
      }
    }
  }
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, scale / 24);
  ctx.strokeStyle = "rgba(78, 112, 54, 0.45)";
  ctx.stroke(tufts);
  ctx.fillStyle = "#fff4d6";
  ctx.fill(flowers[0]);
  ctx.fillStyle = "#f2b84b";
  ctx.fill(flowers[1]);

  // ---- plots: owner tint plus a dashed clay border; faint lines between unclaimed plots ----
  const px0 = Math.floor(x0 / S);
  const px1 = Math.floor(x1 / S);
  const py0 = Math.floor(y0 / S);
  const py1 = Math.floor(y1 / S);
  const plotPx = S * scale;
  for (let py = py0; py <= py1; py++) {
    for (let px = px0; px <= px1; px++) {
      const { sx, sy } = tileToScreen(cam, px * S, py * S);
      const left = Math.round(sx - half);
      const top = Math.round(sy - half);
      const owner = mirror.plots.get(plotKey(px, py));
      const isCommons = px === commons.px && py === commons.py;
      ctx.setLineDash([]);
      if (owner) {
        const mine = owner === me;
        ctx.fillStyle = mine
          ? "rgba(255, 238, 196, 0.32)"
          : `hsla(${ownerHue(owner)}, 65%, 72%, 0.2)`;
        ctx.fillRect(left, top, plotPx, plotPx);
        ctx.setLineDash([scale * 0.28, scale * 0.2]);
        ctx.lineWidth = mine ? 2.5 : 1.75;
        ctx.strokeStyle = mine ? CLAY_DEEP : "rgba(180, 83, 47, 0.75)";
        ctx.strokeRect(left + 2, top + 2, plotPx - 4, plotPx - 4);
      } else if (isCommons) {
        ctx.setLineDash([scale * 0.12, scale * 0.18]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(201, 150, 62, 0.75)";
        ctx.strokeRect(left + 2, top + 2, plotPx - 4, plotPx - 4);
      } else {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(70, 96, 48, 0.14)";
        ctx.strokeRect(left + 0.5, top + 0.5, plotPx, plotPx);
      }
    }
  }
  ctx.setLineDash([]);

  // ---- blocks: raised tiles with a ground shadow, top highlight and bottom shade ----
  const inset = Math.max(1, Math.round(scale * 0.05));
  const radius = Math.max(2, scale * 0.14);
  const lip = Math.max(2, Math.round(scale * 0.16));
  for (const [key, block] of mirror.blocks) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const { sx, sy } = tileToScreen(cam, x, y);
    const left = Math.round(sx - half) + inset;
    const top = Math.round(sy - half) + inset;
    const size = Math.round(scale) - inset * 2;
    ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
    ctx.beginPath();
    ctx.roundRect(left + 1, top + lip * 0.6, size, size, radius);
    ctx.fill();
    ctx.fillStyle = BLOCK_COLORS[block];
    ctx.beginPath();
    ctx.roundRect(left, top, size, size, radius);
    ctx.fill();
    // Bottom shade, then top highlight, both inset so the rounded corners stay clean.
    ctx.fillStyle = "rgba(70, 40, 18, 0.22)";
    ctx.beginPath();
    ctx.roundRect(left, top + size - lip, size, lip, [0, 0, radius, radius]);
    ctx.fill();
    ctx.fillStyle = block === "glass" ? "rgba(255,255,255,0.6)" : "rgba(255, 250, 235, 0.32)";
    ctx.beginPath();
    ctx.roundRect(left + radius * 0.5, top + inset, size - radius, Math.max(2, lip * 0.55), 2);
    ctx.fill();
    if (block === "glass") {
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = Math.max(1, scale / 22);
      ctx.beginPath();
      ctx.moveTo(left + size * 0.3, top + size * 0.68);
      ctx.lineTo(left + size * 0.62, top + size * 0.36);
      ctx.stroke();
    }
    // Built by the town: a little sun-gold rosette in the corner.
    if (mirror.townBuilt.has(key)) {
      const r = Math.max(2.5, scale * 0.11);
      ctx.fillStyle = "#f2b84b";
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = Math.max(1, scale / 28);
      ctx.beginPath();
      ctx.arc(left + size - r * 1.3, top + r * 1.3, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawTownHall(ctx, mirror, cam);

  // ---- hearths: a little house, drawn under residents ----
  for (const r of mirror.residents.values()) {
    if (!r.hearth) continue;
    const { sx, sy } = tileToScreen(cam, r.hearth.x, r.hearth.y);
    if (sx < -scale || sy < -scale || sx > width + scale || sy > height + scale) continue;
    ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + half * 0.62, half * 0.62, half * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.fillRect(sx - half * 0.52, sy - half * 0.2, half * 1.04, half * 0.78);
    ctx.fillStyle = "#f2b84b";
    ctx.beginPath();
    ctx.roundRect(sx - half * 0.14, sy + half * 0.12, half * 0.28, half * 0.46, half * 0.08);
    ctx.fill();
    ctx.fillStyle = HEARTH_COLOR;
    ctx.beginPath();
    ctx.moveTo(sx - half * 0.72, sy - half * 0.12);
    ctx.lineTo(sx, sy - half * 0.78);
    ctx.lineTo(sx + half * 0.72, sy - half * 0.12);
    ctx.closePath();
    ctx.fill();
  }

  const self = me ? mirror.residents.get(me) : undefined;
  if (buildMode && self) {
    const r = config.reach;
    const { sx, sy } = tileToScreen(cam, self.x - r, self.y - r);
    ctx.setLineDash([scale * 0.22, scale * 0.16]);
    ctx.strokeStyle = "rgba(255, 250, 240, 0.95)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(sx - half, sy - half, scale * (2 * r + 1), scale * (2 * r + 1), scale * 0.25);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- residents: round tokens with a white rim and a soft ground shadow ----
  const tokenR = scale * 0.3;
  const labels: { text: string; x: number; y: number; mine: boolean }[] = [];
  const hall = hallBox(mirror, cam);
  if (hall)
    labels.push({ text: "Town Hall", x: hall.left + hall.w / 2, y: hall.top - 2, mine: false });
  for (const r of mirror.residents.values()) {
    if (!r.online) continue;
    const { sx, sy } = tileToScreen(cam, r.x, r.y);
    if (sx < -scale || sy < -scale || sx > width + scale || sy > height + scale) continue;
    const mine = r.id === me;
    ctx.fillStyle = "rgba(60, 40, 20, 0.24)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + tokenR * 1.05, tokenR * 0.95, tokenR * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    if (mine) {
      ctx.fillStyle = "rgba(242, 184, 75, 0.45)";
      ctx.beginPath();
      ctx.arc(sx, sy, tokenR * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    residentPath(ctx, r.shape, sx, sy, tokenR);
    ctx.fillStyle = RESIDENT_COLOR_HEX[r.color];
    ctx.fill();
    ctx.lineWidth = Math.max(2, scale * 0.075);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    if (mine) {
      residentPath(ctx, r.shape, sx, sy, tokenR + ctx.lineWidth);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = CLAY;
      ctx.stroke();
    }
    // Small shine so the token reads as round and raised.
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.beginPath();
    ctx.ellipse(sx - tokenR * 0.32, sy - tokenR * 0.36, tokenR * 0.28, tokenR * 0.16, -0.6, 0, 7);
    ctx.fill();
    labels.push({
      text: r.kind === "agent" ? `${r.name} ⚙` : r.name,
      x: sx,
      y: sy - tokenR * 1.45,
      mine,
    });
  }

  // ---- light: warm glow at dawn and dusk, dusky violet at night, hearths glow after dark ----
  if (dayPhase !== undefined) {
    const night = nightAmount(dayPhase);
    const golden = Math.sin(Math.PI * night);
    if (golden > 0.02) {
      ctx.fillStyle = `rgba(242, 146, 82, ${(0.13 * golden).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (night > 0.02) {
      // Multiply keeps hues (a clay roof stays warm) while pulling everything toward dusky
      // violet-blue, then a thin violet glaze. Capped so the world stays readable at midnight.
      const k = night * 0.78;
      const r = Math.round(255 - k * 143);
      const g = Math.round(255 - k * 151);
      const b = Math.round(255 - k * 59);
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(84, 62, 168, ${(0.14 * night).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (night > 0.25) {
      ctx.globalCompositeOperation = "lighter";
      const strength = (night - 0.25) / 0.75;
      for (const r of mirror.residents.values()) {
        if (!r.hearth) continue;
        const { sx, sy } = tileToScreen(cam, r.hearth.x, r.hearth.y);
        if (sx < -scale * 3 || sy < -scale * 3 || sx > width + scale * 3 || sy > height + scale * 3)
          continue;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, scale * 2.4);
        g.addColorStop(0, `rgba(242, 170, 80, ${(0.42 * strength).toFixed(3)})`);
        g.addColorStop(1, "rgba(242, 170, 80, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(sx - scale * 2.4, sy - scale * 2.4, scale * 4.8, scale * 4.8);
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ---- name labels on little paper tags, above the night so they stay readable ----
  // Canvas text can't execute anything, so names are safe to draw as-is.
  const fontSize = Math.max(11, Math.round(scale / 3.4));
  const font = `600 ${fontSize}px "Figtree Variable", system-ui, sans-serif`;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padX = fontSize * 0.55;
  const tagH = fontSize + 8;
  // Nudge a tag up when it would sit on top of a neighbor's, so names next to each other stay legible.
  labels.sort((a, b) => b.y - a.y || a.x - b.x);
  const placed: { left: number; right: number; top: number }[] = [];
  for (const l of labels) {
    const w = labelWidth(ctx, font, l.text) + padX * 2;
    let top = l.y - tagH;
    for (let tries = 0; tries < 4; tries++) {
      const hit = placed.some(
        (p) =>
          l.x - w / 2 < p.right + 2 &&
          l.x + w / 2 > p.left - 2 &&
          top < p.top + tagH + 2 &&
          top + tagH > p.top - 2,
      );
      if (!hit) break;
      top -= tagH + 3;
    }
    placed.push({ left: l.x - w / 2, right: l.x + w / 2, top });
    ctx.fillStyle = "rgba(74, 52, 28, 0.16)";
    ctx.beginPath();
    ctx.roundRect(l.x - w / 2, top + 1.5, w, tagH, tagH / 2);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = l.mine ? CLAY : PAPER_EDGE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(l.x - w / 2, top, w, tagH, tagH / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = l.mine ? CLAY_DEEP : INK;
    ctx.fillText(l.text, l.x, top + tagH / 2 + 0.5);
  }
  ctx.textBaseline = "alphabetic";
}

/** The Town Hall's footprint on screen, or undefined when it's off screen or unknown. */
function hallBox(mirror: Mirror, cam: Camera) {
  const tiles = mirror.townHall;
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

/**
 * The Town Hall: a small storybook civic building on its tiles in the Commons. Columns under a clay
 * pediment, a gold door, stone steps, and a flag. Residents walk across it (old worlds must replay),
 * so it's drawn under them, like a hearth.
 */
function drawTownHall(ctx: CanvasRenderingContext2D, mirror: Mirror, cam: Camera) {
  const box = hallBox(mirror, cam);
  if (!box) return;
  const { left, top, w, h } = box;
  const s = cam.scale;
  const base = top + h - s * 0.12;
  // Ground shadow.
  ctx.fillStyle = "rgba(74, 52, 28, 0.22)";
  ctx.beginPath();
  ctx.ellipse(left + w / 2, base + s * 0.04, w * 0.46, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // Steps.
  ctx.fillStyle = "#c9c2b5";
  ctx.beginPath();
  ctx.roundRect(left + w * 0.12, base - s * 0.2, w * 0.76, s * 0.22, s * 0.05);
  ctx.fill();
  ctx.fillStyle = "#b3ab9c";
  ctx.fillRect(left + w * 0.12, base - s * 0.03, w * 0.76, s * 0.05);
  // Body.
  const bodyTop = top + h * 0.42;
  const bodyLeft = left + w * 0.16;
  const bodyW = w * 0.68;
  ctx.fillStyle = PAPER;
  ctx.fillRect(bodyLeft, bodyTop, bodyW, base - s * 0.2 - bodyTop);
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(bodyLeft + 0.5, bodyTop + 0.5, bodyW - 1, base - s * 0.2 - bodyTop - 1);
  // Columns.
  ctx.fillStyle = "#e8dfcc";
  const colW = bodyW * 0.07;
  for (const f of [0.08, 0.3, 0.63, 0.85]) {
    ctx.fillRect(
      bodyLeft + bodyW * f,
      bodyTop + s * 0.06,
      colW,
      base - s * 0.26 - bodyTop - s * 0.06,
    );
  }
  // Door: a gold arch in the middle.
  const doorW = bodyW * 0.2;
  const doorH = (base - s * 0.2 - bodyTop) * 0.62;
  ctx.fillStyle = "#f2b84b";
  ctx.beginPath();
  ctx.roundRect(left + w / 2 - doorW / 2, base - s * 0.2 - doorH, doorW, doorH, [
    doorW / 2,
    doorW / 2,
    0,
    0,
  ]);
  ctx.fill();
  // Pediment roof.
  const roofBase = bodyTop + s * 0.04;
  ctx.fillStyle = HEARTH_COLOR;
  ctx.beginPath();
  ctx.moveTo(left + w * 0.08, roofBase);
  ctx.lineTo(left + w / 2, top + h * 0.06);
  ctx.lineTo(left + w * 0.92, roofBase);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = CLAY_DEEP;
  ctx.fillRect(left + w * 0.08, roofBase - s * 0.02, w * 0.84, s * 0.08);
  // A round window in the pediment.
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(left + w / 2, top + h * 0.28, s * 0.1, 0, Math.PI * 2);
  ctx.fill();
  // Flag.
  const poleX = left + w / 2;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, s / 30);
  ctx.beginPath();
  ctx.moveTo(poleX, top + h * 0.07);
  ctx.lineTo(poleX, top - s * 0.32);
  ctx.stroke();
  ctx.fillStyle = "#5e7f45";
  ctx.beginPath();
  ctx.moveTo(poleX, top - s * 0.32);
  ctx.lineTo(poleX + s * 0.3, top - s * 0.24);
  ctx.lineTo(poleX, top - s * 0.15);
  ctx.closePath();
  ctx.fill();
}
