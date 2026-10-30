/**
 * The zoomed-out map's marks (`mapDetail(scale).marks`): each town square's name, the Commons
 * downtown or the land's own, with a round mark for its Town Hall and its shop over it, and a pin
 * on your home. Drawn at a fixed size whatever the scale, so they read when the plots are small.
 * The names are the town's own words, drawn as canvas text.
 */
import type { Tile } from "@terrakin/sim";
import { iconPath } from "@terrakin/ui/icon-path";
import type { IconName } from "@terrakin/ui/icons";
import { type Camera, tileToScreen } from "../camera";
import { type PlacesWorld, townSquares } from "../places";
import { labelWidth } from "./labels";
import { CLAY, CLAY_DEEP, INK, PAPER, PAPER_EDGE } from "./palette";

/** A hall's or shop's round mark, across, in CSS pixels. */
const BADGE = 26;
/** The home pin, tall, in CSS pixels. */
const PIN = 30;
const NAME_SIZE = 14;
const NAME_FONT = `italic 600 ${NAME_SIZE}px "Fraunces Variable", Georgia, serif`;

export function paintMapMarks(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  world: PlacesWorld,
  hearth: Tile | null | undefined,
) {
  const { width, height } = cam;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of townSquares(world)) {
    const { sx, sy } = tileToScreen(cam, s.green.x, s.green.y);
    if (sx < -120 || sx > width + 120 || sy < -60 || sy > height + 60) continue;
    // The hall and the shop side by side over the name.
    const marks: IconName[] = s.shop.length > 0 ? ["town", "shop"] : ["town"];
    const gap = 6;
    const row = marks.length * BADGE + (marks.length - 1) * gap;
    const badgeY = sy - BADGE / 2 - 4;
    marks.forEach((name, i) => {
      paintBadge(ctx, name, sx - row / 2 + BADGE / 2 + i * (BADGE + gap), badgeY);
    });
    paintName(ctx, s.name, sx, sy + NAME_SIZE * 0.9);
  }
  if (hearth) {
    const { sx, sy } = tileToScreen(cam, hearth.x, hearth.y);
    if (sx > -PIN && sx < width + PIN && sy > -PIN && sy < height + PIN * 2) paintPin(ctx, sx, sy);
  }
  ctx.restore();
}

/** A round paper mark with the icon stroked in clay. */
function paintBadge(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number) {
  const r = BADGE / 2;
  ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
  ctx.beginPath();
  ctx.arc(x, y + 1.5, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const glyph = BADGE * 0.6;
  ctx.save();
  ctx.translate(x - glyph / 2, y - glyph / 2);
  ctx.scale(glyph / 24, glyph / 24);
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = 2.25;
  ctx.stroke(iconPath(name));
  ctx.restore();
}

/** A land's name on a soft paper label. */
function paintName(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.font = NAME_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = labelWidth(ctx, NAME_FONT, text) + NAME_SIZE * 1.2;
  const h = NAME_SIZE * 1.7;
  ctx.fillStyle = "rgba(255, 250, 240, 0.92)";
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fillText(text, x, y + 0.5);
}

/** Your home: a clay pin whose point stands on your hearth. */
function paintPin(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  // Lucide's pin has its point at (12, 22) on its grid.
  const k = PIN / 24;
  ctx.translate(x - 12 * k, y - 22 * k);
  ctx.scale(k, k);
  const pin = iconPath("pin");
  ctx.fillStyle = CLAY;
  ctx.fill(pin);
  ctx.strokeStyle = CLAY_DEEP;
  ctx.lineWidth = 1.5;
  ctx.stroke(pin);
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(12, 10, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
