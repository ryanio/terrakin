import { HEARTH_COLOR } from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";
import { CROP_HEX } from "@terrakin/ui/item-art";
import { type Camera, tileToScreen } from "../camera";
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

/**
 * The Town Hall: a small storybook civic building on its tiles in the Commons. Columns under a clay
 * pediment, a gold door, stone steps, and a flag. It's drawn under the residents, like a hearth:
 * nobody walks onto it once buildings are solid, so whoever stands beside it is in front of it.
 */
export function drawTownHall(ctx: CanvasRenderingContext2D, mirror: Mirror, cam: Camera) {
  const box = tilesBox(mirror.townHall, cam);
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
  ctx.fillStyle = BRAND_HEX.sun;
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
  ctx.fillStyle = BRAND_HEX.moss;
  ctx.beginPath();
  ctx.moveTo(poleX, top - s * 0.32);
  ctx.lineTo(poleX + s * 0.3, top - s * 0.24);
  ctx.lineTo(poleX, top - s * 0.15);
  ctx.closePath();
  ctx.fill();
}

/**
 * The town shop (RFC 0008): a small storybook shop on its tiles on the Commons' south edge. Cream
 * walls under a moss roof, a striped awning, two windows with jars and fruit on the sill, a door,
 * and a sign hanging from a bracket. Like the Town Hall, it's drawn under the residents.
 */
export function drawShop(ctx: CanvasRenderingContext2D, mirror: Mirror, cam: Camera) {
  const box = tilesBox(mirror.shop, cam);
  if (!box) return;
  const { left, top, w, h } = box;
  const s = cam.scale;
  const base = top + h - s * 0.1;
  const line = Math.max(1, s / 30);
  ctx.save();
  ctx.lineJoin = "round";
  // Ground shadow.
  ctx.fillStyle = "rgba(74, 52, 28, 0.22)";
  ctx.beginPath();
  ctx.ellipse(left + w / 2, base + s * 0.03, w * 0.48, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // Walls, on a stone footing.
  const bodyL = left + w * 0.07;
  const bodyR = left + w * 0.93;
  const bodyTop = top + h * 0.34;
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = line;
  ctx.fillRect(bodyL, bodyTop, bodyR - bodyL, base - bodyTop);
  ctx.strokeRect(bodyL + 0.5, bodyTop + 0.5, bodyR - bodyL - 1, base - bodyTop - 1);
  ctx.fillStyle = "#c9c2b5";
  ctx.fillRect(bodyL, base - s * 0.1, bodyR - bodyL, s * 0.1);
  // A chimney, then the roof over it.
  ctx.fillStyle = CLAY;
  ctx.fillRect(left + w * 0.74, top + h * 0.02, w * 0.07, h * 0.2);
  ctx.fillStyle = CLAY_DEEP;
  ctx.fillRect(left + w * 0.73, top + h * 0.01, w * 0.09, h * 0.04);
  ctx.fillStyle = BRAND_HEX.moss;
  ctx.beginPath();
  ctx.moveTo(left + w * 0.02, bodyTop + s * 0.04);
  ctx.lineTo(left + w * 0.15, top + h * 0.1);
  ctx.lineTo(left + w * 0.85, top + h * 0.1);
  ctx.lineTo(left + w * 0.98, bodyTop + s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(43, 38, 32, 0.22)";
  ctx.lineWidth = line;
  ctx.beginPath();
  for (const f of [0.35, 0.65]) {
    const y = top + h * 0.1 + (bodyTop - top - h * 0.1) * f;
    const inset = w * 0.13 * (1 - f);
    ctx.moveTo(left + w * 0.02 + inset, y);
    ctx.lineTo(left + w * 0.98 - inset, y);
  }
  ctx.stroke();
  ctx.fillStyle = BRAND_HEX.mossLight;
  ctx.fillRect(left + w * 0.15, top + h * 0.08, w * 0.7, h * 0.035);
  // The striped awning, scalloped along its edge.
  const awnL = left + w * 0.05;
  const awnR = left + w * 0.95;
  const awnTop = bodyTop + s * 0.06;
  const awnBottom = bodyTop + s * 0.3;
  const stripes = 9;
  const sw = (awnR - awnL) / stripes;
  // Its shade on the wall first, so the pale stripes stand off the pale wall.
  ctx.fillStyle = "rgba(74, 52, 28, 0.16)";
  ctx.fillRect(bodyL, awnBottom, bodyR - bodyL, sw * 0.75);
  ctx.strokeStyle = "rgba(143, 61, 32, 0.55)";
  ctx.lineWidth = line;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? CLAY : BRAND_HEX.paper2;
    ctx.beginPath();
    ctx.moveTo(awnL + i * sw, awnTop);
    ctx.lineTo(awnL + (i + 1) * sw, awnTop);
    ctx.lineTo(awnL + (i + 1) * sw, awnBottom);
    ctx.arc(awnL + (i + 0.5) * sw, awnBottom, sw / 2, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = CLAY_DEEP;
  ctx.fillRect(awnL, awnTop - s * 0.03, awnR - awnL, s * 0.05);
  // Two windows with things on the sill: jars on the left, fruit on the right.
  const winTop = awnBottom + s * 0.26;
  const winH = base - s * 0.22 - winTop;
  const windowAt = (fx: number, things: "jars" | "fruit") => {
    const ww = w * 0.24;
    const wx = left + w * fx - ww / 2;
    ctx.fillStyle = PAPER_EDGE;
    ctx.fillRect(wx - s * 0.04, winTop - s * 0.04, ww + s * 0.08, winH + s * 0.08);
    ctx.fillStyle = "#cfe6ee";
    ctx.fillRect(wx, winTop, ww, winH);
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.beginPath();
    ctx.moveTo(wx + ww * 0.1, winTop + winH * 0.55);
    ctx.lineTo(wx + ww * 0.45, winTop + winH * 0.05);
    ctx.lineTo(wx + ww * 0.6, winTop + winH * 0.05);
    ctx.lineTo(wx + ww * 0.25, winTop + winH * 0.55);
    ctx.fill();
    const sill = winTop + winH;
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(wx - s * 0.06, sill - s * 0.02, ww + s * 0.12, s * 0.06);
    if (things === "jars") {
      const fills = [BRAND_HEX.sun, CLAY, BRAND_HEX.moss];
      fills.forEach((fill, i) => {
        const jx = wx + ww * (0.2 + i * 0.3);
        const jw = ww * 0.2;
        const jh = winH * 0.42;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(jx - jw / 2, sill - s * 0.02 - jh, jw, jh, jw * 0.25);
        ctx.fill();
        ctx.fillStyle = PAPER;
        ctx.fillRect(jx - jw * 0.32, sill - s * 0.02 - jh * 0.62, jw * 0.64, jh * 0.3);
        ctx.fillStyle = "#c9a25a";
        ctx.fillRect(jx - jw * 0.55, sill - s * 0.02 - jh - jh * 0.16, jw * 1.1, jh * 0.18);
      });
    } else {
      const fruit = [CROP_HEX.lemon, CROP_HEX.tomato, CROP_HEX.lemon, CROP_HEX.strawberry];
      fruit.forEach((fill, i) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(
          wx + ww * (0.18 + i * 0.21),
          sill - s * 0.02 - winH * 0.13,
          winH * 0.13,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });
    }
    // A box of flowers under the window.
    ctx.fillStyle = "#9a6b43";
    ctx.fillRect(wx, sill + s * 0.04, ww, s * 0.09);
    ctx.fillStyle = CROP_HEX.flower;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(wx + ww * (0.14 + i * 0.24), sill + s * 0.04, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  windowAt(0.255, "jars");
  windowAt(0.745, "fruit");
  // The door, with a round window and a gold knob, over a stone step.
  const doorW = w * 0.15;
  const doorTop = awnBottom + s * 0.18;
  const doorL = left + w / 2 - doorW / 2;
  ctx.fillStyle = "#c9c2b5";
  ctx.beginPath();
  ctx.roundRect(doorL - s * 0.08, base - s * 0.08, doorW + s * 0.16, s * 0.12, s * 0.03);
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.moss;
  ctx.beginPath();
  ctx.roundRect(doorL, doorTop, doorW, base - s * 0.06 - doorTop, [
    doorW * 0.45,
    doorW * 0.45,
    0,
    0,
  ]);
  ctx.fill();
  ctx.fillStyle = "#cfe6ee";
  ctx.beginPath();
  ctx.arc(left + w / 2, doorTop + doorW * 0.5, doorW * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.arc(
    doorL + doorW * 0.78,
    doorTop + (base - doorTop) * 0.6,
    Math.max(1.2, s * 0.035),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // A sign hanging from a bracket on the corner: a jar on a paper board.
  const armY = bodyTop + s * 0.42;
  const armX = bodyR + w * 0.06;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, s / 26);
  ctx.beginPath();
  ctx.moveTo(bodyR, armY);
  ctx.lineTo(armX, armY);
  ctx.moveTo(armX - w * 0.04, armY);
  ctx.lineTo(armX - w * 0.04, armY + s * 0.08);
  ctx.stroke();
  const signW = s * 0.42;
  const signH = s * 0.36;
  const signX = armX - w * 0.04 - signW / 2;
  const signY = armY + s * 0.08;
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = Math.max(1, s / 22);
  ctx.beginPath();
  ctx.roundRect(signX, signY, signW, signH, s * 0.06);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.roundRect(signX + signW * 0.32, signY + signH * 0.3, signW * 0.36, signH * 0.5, signW * 0.08);
  ctx.fill();
  ctx.fillStyle = CLAY;
  ctx.fillRect(signX + signW * 0.28, signY + signH * 0.2, signW * 0.44, signH * 0.14);
  ctx.restore();
}
