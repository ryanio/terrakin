import {
  type BlockKind,
  blockFill,
  type Crop,
  mixHex,
  THEME_INFO,
  type Theme,
  type ThemePalette,
} from "@terrakin/sim";
import { CROP_HEX, onVine } from "@terrakin/ui/item-art";
import { paintMotif, patternMotifs as patternMotifsFor } from "@terrakin/ui/looks";
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

/** One raised block with its ground shadow, at (left, top), `size` across. */
export function paintBlock(
  ctx: CanvasRenderingContext2D,
  block: BlockKind,
  left: number,
  top: number,
  size: number,
  scale: number,
  skin?: BlockSkin,
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
  if (block === "glass") {
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = Math.max(1, scale / 22);
    ctx.beginPath();
    ctx.moveTo(left + size * 0.3, top + size * 0.68);
    ctx.lineTo(left + size * 0.62, top + size * 0.36);
    ctx.stroke();
  }
}

/** The face of a planter (dark soil), a kitchen (two burners), or a workbench (planks). */
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

/**
 * A crop in a planter, drawn from its entry in the catalog and how far along it is (0 to 1): a
 * sprout that grows, then the crop's color in small fruit or petals once it's ready, or, for a crop
 * that grows on a vine, a vine along the soil.
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
  if (done >= 1) {
    ctx.fillStyle = CROP_HEX[crop];
    ctx.strokeStyle = "rgba(43, 38, 32, 0.35)";
    ctx.lineWidth = 1;
    const r = size * 0.09;
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
    ctx.fillStyle = ripe ? CROP_HEX[crop] : mixHex("#8cbf5a", CROP_HEX[crop], swell * 0.5);
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
