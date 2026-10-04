import type { BlockKind, ResidentColor, ResidentShape } from "@terrakin/sim";
import { type Camera, tileToScreen } from "./camera";
import type { Mirror } from "./mirror";

const BLOCK_COLORS: Record<BlockKind, string> = {
  wood: "#a87a4f",
  stone: "#8d9196",
  glass: "#bfe6f5",
  leaf: "#5d9b4a",
};

export function blockColor(block: BlockKind): string {
  return BLOCK_COLORS[block];
}

export const HEARTH_COLOR = "#e07a3f";

export const RESIDENT_COLOR_HEX: Record<ResidentColor, string> = {
  sun: "#ffd166",
  sky: "#7ec8e3",
  leaf: "#8bd17c",
  rose: "#f28da0",
  plum: "#b48ee0",
  sand: "#e8d3a2",
  coal: "#4a4a4a",
  snow: "#f7f7f2",
};

function residentPath(
  ctx: CanvasRenderingContext2D,
  shape: ResidentShape,
  x: number,
  y: number,
  r: number,
) {
  ctx.beginPath();
  if (shape === "square") ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (shape === "diamond") {
    ctx.moveTo(x, y - r * 1.2);
    ctx.lineTo(x + r * 1.2, y);
    ctx.lineTo(x, y + r * 1.2);
    ctx.lineTo(x - r * 1.2, y);
    ctx.closePath();
  } else ctx.arc(x, y, r, 0, Math.PI * 2);
}

// Stable pastel per owner so neighbors' plots are easy to tell apart.
function ownerHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export interface RenderState {
  mirror: Mirror;
  me: string | undefined;
  cam: Camera;
  buildMode: boolean;
}

export function render(ctx: CanvasRenderingContext2D, { mirror, me, cam, buildMode }: RenderState) {
  const { width, height, scale } = cam;
  const { config, commons } = mirror;
  ctx.fillStyle = "#1d2b22";
  ctx.fillRect(0, 0, width, height);

  // Visible tile range.
  const x0 = Math.max(0, Math.floor(cam.cx - width / scale / 2) - 1);
  const x1 = Math.min(config.width - 1, Math.ceil(cam.cx + width / scale / 2) + 1);
  const y0 = Math.max(0, Math.floor(cam.cy - height / scale / 2) - 1);
  const y1 = Math.min(config.height - 1, Math.ceil(cam.cy + height / scale / 2) + 1);
  const half = scale / 2;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const { sx, sy } = tileToScreen(cam, x, y);
      const px = Math.floor(x / config.plotSize);
      const py = Math.floor(y / config.plotSize);
      const owner = mirror.ownerAt(x, y);
      if (px === commons.px && py === commons.py) ctx.fillStyle = "#d9cfa8";
      else if (owner) ctx.fillStyle = `hsl(${ownerHue(owner)} 45% ${owner === me ? 62 : 52}%)`;
      else ctx.fillStyle = (x + y) % 2 === 0 ? "#7fae6b" : "#78a664";
      ctx.fillRect(sx - half, sy - half, scale, scale);

      // Plot borders.
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      if (x % config.plotSize === 0) ctx.fillRect(sx - half, sy - half, 1, scale);
      if (y % config.plotSize === 0) ctx.fillRect(sx - half, sy - half, scale, 1);
    }
  }

  for (const [key, block] of mirror.blocks) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const { sx, sy } = tileToScreen(cam, x, y);
    ctx.fillStyle = blockColor(block);
    ctx.fillRect(sx - half + 1, sy - half + 1, scale - 2, scale - 2);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(sx - half + 1, sy + half - 4, scale - 2, 3);
  }

  // Hearths: a warm square with a roof, drawn under residents.
  for (const r of mirror.residents.values()) {
    if (!r.hearth) continue;
    const { sx, sy } = tileToScreen(cam, r.hearth.x, r.hearth.y);
    if (sx < -scale || sy < -scale || sx > width + scale || sy > height + scale) continue;
    ctx.fillStyle = HEARTH_COLOR;
    ctx.fillRect(sx - half * 0.6, sy - half * 0.2, scale * 0.6, half * 0.8);
    ctx.beginPath();
    ctx.moveTo(sx - half * 0.75, sy - half * 0.2);
    ctx.lineTo(sx, sy - half * 0.8);
    ctx.lineTo(sx + half * 0.75, sy - half * 0.2);
    ctx.closePath();
    ctx.fill();
  }

  const self = me ? mirror.residents.get(me) : undefined;
  if (buildMode && self) {
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    const r = config.reach;
    const { sx, sy } = tileToScreen(cam, self.x - r, self.y - r);
    ctx.strokeRect(sx - half, sy - half, scale * (2 * r + 1), scale * (2 * r + 1));
  }

  ctx.textAlign = "center";
  ctx.font = `${Math.max(11, Math.floor(scale / 3))}px system-ui, sans-serif`;
  for (const r of mirror.residents.values()) {
    if (!r.online) continue;
    const { sx, sy } = tileToScreen(cam, r.x, r.y);
    if (sx < -scale || sy < -scale || sx > width + scale || sy > height + scale) continue;
    residentPath(ctx, r.shape, sx, sy, scale * 0.3);
    ctx.fillStyle = RESIDENT_COLOR_HEX[r.color];
    ctx.fill();
    ctx.lineWidth = r.id === me ? 4 : 2;
    ctx.strokeStyle = r.id === me ? "#ffffff" : "#1d2b22";
    ctx.stroke();
    // Canvas text can't execute anything, so names are safe to draw as-is.
    ctx.fillStyle = "#fff";
    ctx.fillText(r.kind === "agent" ? `${r.name} ⚙` : r.name, sx, sy - scale * 0.45);
  }
}
