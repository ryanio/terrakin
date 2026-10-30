import {
  type BlockKind,
  blockFill,
  type Crop,
  DOOR_LOOK,
  type Grade,
  KILN_GLOW,
  mixHex,
  THEME_INFO,
  type Theme,
  type ThemePalette,
  wallMarks,
} from "@terrakin/sim";
import { paintMarks } from "@terrakin/ui/ground-art";
import { CROP_HEX, onVine } from "@terrakin/ui/item-art";
import { paintMotif, patternMotifs as patternMotifsFor } from "@terrakin/ui/looks";
import { paintSparkle } from "./decor";
import { WORKSHOP_BLOCKS } from "./palette";

/** How a themed plot dresses its blocks. */
export interface BlockSkin {
  theme?: Theme;
  palette?: ThemePalette;
  /** The owner's uploaded pattern, used as the face of wood and stone. */
  image?: HTMLImageElement;
  imageId?: string;
}

/** The color of a block on a plot with this skin. */
function skinnedColor(block: BlockKind, skin: BlockSkin | undefined): string {
  return blockFill(block, skin?.palette);
}

/**
 * One raised block with its ground shadow, at (left, top), `size` across, a wall or window with its
 * surface (`WALL_LOOK`) and a made material's grade (`GRADE_LOOK`, RFC 0051) over it. A wall costs
 * a clip and a dozen marks, so the map draws each wall once per size and grade into a sprite and
 * stamps that, rather than calling this every frame.
 */
export function paintBlock(
  ctx: CanvasRenderingContext2D,
  block: BlockKind,
  left: number,
  top: number,
  size: number,
  scale: number,
  skin?: BlockSkin,
  grade: Grade = "plain",
) {
  const inset = Math.max(1, Math.round(scale * 0.05));
  const radius = Math.max(2, scale * 0.14);
  const lip = Math.max(2, Math.round(scale * 0.16));
  ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
  ctx.beginPath();
  ctx.roundRect(left + 1, top + lip * 0.6, size, size, radius);
  ctx.fill();
  ctx.fillStyle = skinnedColor(block, skin);
  ctx.beginPath();
  ctx.roundRect(left, top, size, size, radius);
  ctx.fill();
  const walls = block === "wood" || block === "stone";
  const marks = skin?.image && walls ? [] : wallMarks(block, grade);
  if (marks.length > 0) {
    // The wall's surface (bricks, beams, boards, panes), the same marks the 3D views and the plot
    // photos draw, over its color, so a theme's wood keeps its planks.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, size, size, radius);
    ctx.clip();
    paintMarks(ctx, marks, left, top, size, size);
    ctx.restore();
  }
  if (skin?.image && walls) {
    // The owner's own pattern as the face of the wall, cropped square.
    const img = skin.image;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, size, size, radius);
    ctx.clip();
    ctx.globalAlpha = block === "stone" ? 0.7 : 0.9;
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      left,
      top,
      size,
      size,
    );
    ctx.restore();
  } else if (skin?.theme && block === "wood") {
    // A tiny motif from the theme: a lemon slice on lemon wood, a star on night wood.
    const info = THEME_INFO[skin.theme];
    const m = info.motif === "stripes" || info.motif === "gingham" ? "dots" : info.motif;
    const [motif] = patternMotifsFor(m);
    if (motif) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      // Scale the first motif of the pattern so it sits in the middle of the block.
      const u = size * 0.9;
      const cx = "x" in motif ? motif.x : 0.5;
      const cy = "y" in motif ? motif.y : 0.5;
      paintMotif(ctx, motif, info.palette, left + size / 2 - cx * u, top + size * 0.45 - cy * u, u);
      ctx.restore();
    }
  }
  // Bottom shade, then top highlight, both inset so the rounded corners stay clean.
  ctx.fillStyle = "rgba(70, 40, 18, 0.22)";
  ctx.beginPath();
  ctx.roundRect(left, top + size - lip, size, lip, [0, 0, radius, radius]);
  ctx.fill();
  ctx.fillStyle = block === "glass" ? "rgba(255,255,255,0.6)" : "rgba(255, 250, 235, 0.32)";
  ctx.beginPath();
  ctx.roundRect(left + radius * 0.5, top + inset, size - radius, Math.max(2, lip * 0.55), 2);
  ctx.fill();
  if (WORKSHOP_BLOCKS.has(block)) paintWorkshop(ctx, block, left, top, size, scale);
  // Stairs (RFC 0028): treads across the tile, each with a shadow under its nose, so a staircase
  // reads as one from above and not as a wall.
  if (block === "stairs") {
    const tread = size / 4;
    for (let i = 1; i < 4; i++) {
      ctx.fillStyle = "rgba(70, 40, 18, 0.3)";
      ctx.fillRect(left + inset, top + tread * i - 1, size - inset * 2, Math.max(1, scale / 18));
      ctx.fillStyle = "rgba(255, 250, 235, 0.3)";
      ctx.fillRect(left + inset, top + tread * i + 1, size - inset * 2, Math.max(1, scale / 30));
    }
  }
}

/**
 * A door (decision 0349), in the sim's `DOOR_LOOK`: a raised frame the height of a wall with a
 * painted door set in its middle, its top rounded and a knob on one side, so the way into a home
 * reads at a glance among its walls. Someone standing in the doorway is drawn over it.
 */
export function paintDoor(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  scale: number,
) {
  const radius = Math.max(2, scale * 0.14);
  const lip = Math.max(2, Math.round(scale * 0.16));
  ctx.save();
  ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
  ctx.beginPath();
  ctx.roundRect(left + 1, top + lip * 0.6, size, size, radius);
  ctx.fill();
  ctx.fillStyle = DOOR_LOOK.frame;
  ctx.beginPath();
  ctx.roundRect(left, top, size, size, radius);
  ctx.fill();
  // The door in its opening: `opening` of the tile wide, from near the top down to the sill.
  const w = size * DOOR_LOOK.opening;
  const x = left + (size - w) / 2;
  const y = top + size * 0.14;
  const tall = size - lip * 0.6 - size * 0.14;
  const arch = [w / 2, w / 2, 0, 0];
  ctx.fillStyle = "rgba(60, 32, 14, 0.45)";
  ctx.beginPath();
  ctx.roundRect(x - 1, y - 1, w + 2, tall + 1, arch);
  ctx.fill();
  ctx.fillStyle = DOOR_LOOK.panel;
  ctx.beginPath();
  ctx.roundRect(x, y, w, tall, arch);
  ctx.fill();
  // A seam between its two planks, and the knob.
  ctx.strokeStyle = "rgba(60, 24, 14, 0.35)";
  ctx.lineWidth = Math.max(1, scale / 30);
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y + w * 0.3);
  ctx.lineTo(x + w / 2, y + tall);
  ctx.stroke();
  ctx.fillStyle = DOOR_LOOK.knob;
  ctx.beginPath();
  ctx.arc(x + w * 0.78, y + tall * 0.58, Math.max(1, size * 0.05), 0, Math.PI * 2);
  ctx.fill();
  // The frame's bottom shade and top highlight, as a wall has.
  ctx.fillStyle = "rgba(70, 40, 18, 0.22)";
  ctx.beginPath();
  ctx.roundRect(left, top + size - lip, size, lip, [0, 0, radius, radius]);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 250, 235, 0.32)";
  ctx.beginPath();
  ctx.roundRect(left + radius * 0.5, top + 1, size - radius, Math.max(2, lip * 0.55), 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The face of a planter (dark soil), a kitchen (two burners), a workbench (planks), or a kiln (RFC
 * 0047): a brick dome with a dark arched mouth, which `paintKilnFire` fills while a pot fires.
 */
function paintWorkshop(
  ctx: CanvasRenderingContext2D,
  block: BlockKind,
  left: number,
  top: number,
  size: number,
  scale: number,
) {
  ctx.save();
  if (block === "planter") {
    const pad = size * 0.16;
    ctx.fillStyle = "#4a3222";
    ctx.beginPath();
    ctx.roundRect(
      left + pad,
      top + pad,
      size - pad * 2,
      size - pad * 2.4,
      Math.max(2, scale * 0.08),
    );
    ctx.fill();
  } else if (block === "kitchen") {
    ctx.fillStyle = "#3d2a22";
    for (const cx of [0.32, 0.68]) {
      ctx.beginPath();
      ctx.arc(left + size * cx, top + size * 0.42, size * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255, 196, 120, 0.85)";
    ctx.lineWidth = Math.max(1, scale / 30);
    for (const cx of [0.32, 0.68]) {
      ctx.beginPath();
      ctx.arc(left + size * cx, top + size * 0.42, size * 0.07, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (block === "kiln") {
    // A dome of brick, a course line across it, and the mouth low in front.
    ctx.fillStyle = "rgba(70, 30, 18, 0.25)";
    ctx.beginPath();
    ctx.ellipse(left + size / 2, top + size * 0.5, size * 0.36, size * 0.3, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = "rgba(70, 30, 18, 0.4)";
    ctx.lineWidth = Math.max(1, scale / 30);
    ctx.beginPath();
    ctx.moveTo(left + size * 0.18, top + size * 0.5);
    ctx.lineTo(left + size * 0.82, top + size * 0.5);
    ctx.stroke();
    kilnMouth(ctx, left, top, size, "#3a2219");
  } else {
    ctx.strokeStyle = "rgba(70, 40, 18, 0.45)";
    ctx.lineWidth = Math.max(1, scale / 28);
    for (const fy of [0.32, 0.54]) {
      ctx.beginPath();
      ctx.moveTo(left + size * 0.12, top + size * fy);
      ctx.lineTo(left + size * 0.88, top + size * fy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A kiln's arched mouth, low on its face, in `fill`. */
function kilnMouth(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  fill: string,
) {
  const w = size * 0.3;
  const h = size * 0.24;
  const x = left + (size - w) / 2;
  const y = top + size * 0.58;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + w / 2);
  ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

/**
 * A kiln firing a pot (RFC 0047): its mouth burns, and a warm glow spills out of it, by day too.
 * Nothing says what's inside.
 */
export function paintKilnFire(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  scale: number,
) {
  ctx.save();
  const cx = left + size / 2;
  const cy = top + size * 0.72;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.8);
  g.addColorStop(0, "rgba(255, 179, 71, 0.6)");
  g.addColorStop(1, "rgba(255, 150, 60, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - scale, cy - scale, scale * 2, scale * 2);
  kilnMouth(ctx, left, top, size, KILN_GLOW);
  ctx.restore();
}

/**
 * A kiln whose pot is ready to take out (RFC 0047): a gold halo over its dome and three sparkles
 * edged in amber, twinkling in turn unless motion is still, so a ready kiln shows from across the
 * plot on any ground.
 */
export function paintKilnReady(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  now: number,
  still: boolean,
) {
  ctx.save();
  const cx = left + size * 0.62;
  const cy = top + size * 0.02;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
  halo.addColorStop(0, "rgba(255, 214, 90, 0.55)");
  halo.addColorStop(1, "rgba(255, 214, 90, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(cx - size * 0.5, cy - size * 0.5, size, size);
  for (const [i, [fx, fy, r]] of (
    [
      [0.8, 0.0, 0.34],
      [0.42, -0.18, 0.2],
      [0.22, 0.14, 0.14],
    ] as const
  ).entries()) {
    const pulse = still ? 1 : 0.8 + 0.2 * Math.sin(now / 240 + i * 2.1);
    const sx = left + size * fx;
    const sy = top + size * fy;
    const rr = size * r * pulse;
    // An amber edge first, a touch larger, so the gold reads on pale ground and on stone.
    paintSparkle(ctx, sx, sy, rr + size * 0.035, "#b8741a");
    paintSparkle(ctx, sx, sy, rr, "#ffd84a");
  }
  ctx.restore();
}

/** A crop's unripe green, and how far along a crop sets its fruit. Both are in the cards' own copy. */
const BUD = "#8cbf5a";
const FRUIT_SET = 0.45;

/**
 * A crop in a planter, drawn from its entry in the catalog and how far along it is (0 to 1): a
 * sprout that grows, its small fruit or petals setting at `FRUIT_SET` and ripening from a green bud
 * to the crop's own color, or, for a crop that grows on a vine, a vine along the soil. The plot
 * photos draw the same shapes (`packages/cards/src/plot.ts`), so keep the two in step.
 */
export function paintCrop(
  ctx: CanvasRenderingContext2D,
  crop: Crop,
  done: number,
  left: number,
  top: number,
  size: number,
) {
  if (onVine(crop)) {
    paintVine(ctx, crop, done, left, top, size);
    return;
  }
  const cx = left + size / 2;
  const base = top + size * 0.66;
  const tall = size * (0.18 + 0.32 * done);
  ctx.save();
  ctx.strokeStyle = "#5f9a43";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, size / 14);
  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.lineTo(cx, base - tall);
  ctx.stroke();
  ctx.fillStyle = "#6fae4c";
  const leaf = size * (0.08 + 0.08 * done);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * leaf, base - tall * 0.55, leaf, leaf * 0.5, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (done >= FRUIT_SET) {
    const ripe = done >= 1;
    const swell = (done - FRUIT_SET) / (1 - FRUIT_SET);
    ctx.fillStyle = ripe ? CROP_HEX[crop] : mixHex(BUD, CROP_HEX[crop], 0.55 + 0.45 * swell);
    ctx.strokeStyle = "rgba(43, 38, 32, 0.35)";
    ctx.lineWidth = 1;
    const r = size * (0.05 + 0.04 * swell);
    for (const [dx, dy] of [
      [-0.16, -0.05],
      [0.16, -0.1],
      [0, -0.2],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx + dx * size, base - tall + dy * size + tall * 0.4, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * A crop on a vine in a planter, like a pumpkin: a vine that spreads along the soil, and its fruit
 * swelling from a green bud, ripening to the crop's color with a stem once it's ready.
 */
function paintVine(
  ctx: CanvasRenderingContext2D,
  crop: Crop,
  done: number,
  left: number,
  top: number,
  size: number,
) {
  const cx = left + size / 2;
  const base = top + size * 0.7;
  const spread = size * (0.14 + 0.2 * done);
  ctx.save();
  ctx.strokeStyle = "#5f9a43";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, size / 16);
  ctx.beginPath();
  ctx.moveTo(cx - spread, base);
  ctx.quadraticCurveTo(cx, base - size * 0.14, cx + spread, base);
  ctx.stroke();
  ctx.fillStyle = "#6fae4c";
  const leaf = size * (0.07 + 0.07 * done);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      cx + side * spread * 0.85,
      base - leaf * 0.3,
      leaf,
      leaf * 0.6,
      side * 0.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  if (done > 0.2) {
    const ripe = done >= 1;
    const swell = (done - 0.2) / 0.8;
    const r = size * (0.08 + 0.15 * swell);
    const y = base - r * 0.55;
    ctx.fillStyle = ripe ? CROP_HEX[crop] : mixHex(BUD, CROP_HEX[crop], swell * 0.5);
    ctx.strokeStyle = "rgba(43, 38, 32, 0.35)";
    ctx.lineWidth = 1;
    for (const dx of [-0.5, 0.5, 0]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx * r, y, r * 0.72, r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (ripe) {
      ctx.strokeStyle = "#76703a";
      ctx.lineWidth = Math.max(1.5, size / 18);
      ctx.beginPath();
      ctx.moveTo(cx, y - r * 0.7);
      ctx.lineTo(cx + r * 0.15, y - r * 1.05);
      ctx.stroke();
    }
  }
  ctx.restore();
}
