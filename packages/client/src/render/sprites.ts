import { fourWayFacing } from "@terrakin/protocol";
import {
  type Direction,
  type GroundKind,
  PET_BOX,
  type PetCoat,
  type PetFace,
  type PetKind,
  type PetPosture,
  type Resident,
} from "@terrakin/sim";
import {
  blinks,
  drawFeelingIcon,
  drawFigure,
  type FeelingIcon,
  FIGURE_BOX,
  type FigureFace,
} from "@terrakin/ui/figure";
import { paintGround } from "@terrakin/ui/ground-art";
import { lookImage, lookPalette, PatternCache } from "@terrakin/ui/looks";
import { drawPet } from "@terrakin/ui/pet-art";

// ---------- sprites: looks drawn once, then stamped every frame ----------

const patterns = new PatternCache();
const sprites = new Map<string, HTMLCanvasElement>();

/** A cached offscreen drawing, `w` by `h` device pixels. Cleared when it grows too big. */
export function sprite(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  let canvas = sprites.get(key);
  if (!canvas) {
    if (sprites.size > 400) sprites.clear();
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(w));
    canvas.height = Math.max(1, Math.ceil(h));
    draw(canvas.getContext("2d") as CanvasRenderingContext2D);
    sprites.set(key, canvas);
  }
  return canvas;
}

/** The pattern a resident wears: their own uploaded tile once it loads, else the named one. */
function clothesPattern(
  ctx: CanvasRenderingContext2D,
  r: Pick<Resident, "pattern" | "patternMedia" | "theme" | "color">,
  u: number,
): { pattern: CanvasPattern | null; key: string } {
  const img = lookImage(r.patternMedia);
  if (img && r.patternMedia) {
    return { pattern: patterns.image(ctx, r.patternMedia, img, u * 0.42), key: r.patternMedia };
  }
  const name = r.pattern ?? "plain";
  return { pattern: patterns.named(ctx, name, lookPalette(r.theme, r.color), u * 0.36), key: name };
}

/** The sprite key's part for a face: only what changes the drawing, so a blink on shut eyes reuses one. */
export function faceKey(face: FigureFace): string {
  const feeling = face.feeling ?? "neutral";
  const blink = face.blink && blinks(feeling) ? 1 : 0;
  return `${feeling}|${blink}|${face.wave ?? 0}|${face.furled ? 1 : 0}`;
}

/** Laid over someone asleep at home while they're away, so they read as not quite here. */
const AWAY_WASH = "rgba(255, 250, 240, 0.4)";
/** How strongly their name tag and sign show. */
export const AWAY_TAG_ALPHA = 0.72;

/**
 * A resident's figure as a sprite at `scale` CSS pixels per tile. Returns the canvas and where its
 * top-left sits relative to the feet, in CSS pixels. Each look, facing, and face (`faceKey`) is
 * drawn once and then stamped. `away` fades it, for someone asleep at home (decision 0086).
 */
export function figureSprite(
  r: Pick<
    Resident,
    | "color"
    | "shape"
    | "theme"
    | "pattern"
    | "patternMedia"
    | "wear"
    | "wearStyle"
    | "hair"
    | "hairColor"
  >,
  scale: number,
  dpr: number,
  facing: Direction = "s",
  face: FigureFace = {},
  away = false,
): { canvas: HTMLCanvasElement; dx: number; dy: number; w: number; h: number } {
  const u = scale * dpr;
  const w = (FIGURE_BOX.right - FIGURE_BOX.left) * u;
  const h = (FIGURE_BOX.bottom - FIGURE_BOX.top) * u;
  const probe = lookImage(r.patternMedia) ? r.patternMedia : (r.pattern ?? "plain");
  // Styles only matter for what's worn, so a style kept for a garment in the drawer costs nothing.
  const styles = (r.wear ?? []).map((w) => {
    const s = r.wearStyle?.[w];
    return s ? `${w}:${s.pattern ?? ""}:${s.color ?? ""}` : "";
  });
  const hair = r.hair ? `${r.hair}:${r.hairColor ?? ""}` : "";
  const key = `fig|${r.color}|${r.shape}|${r.theme ?? ""}|${probe}|${(r.wear ?? []).join(",")}|${styles.join(",")}|${hair}|${fourWayFacing(facing)}|${faceKey(face)}|${away ? "away|" : ""}${u.toFixed(2)}`;
  const canvas = sprite(key, w, h, (ctx) => {
    ctx.translate(-FIGURE_BOX.left * u, -FIGURE_BOX.top * u);
    drawFigure(ctx, u, r, clothesPattern(ctx, r, u).pattern, facing, patterns, face);
    if (!away) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = AWAY_WASH;
    ctx.fillRect(0, 0, w, h);
  });
  return {
    canvas,
    dx: FIGURE_BOX.left * scale,
    dy: FIGURE_BOX.top * scale,
    w: w / dpr,
    h: h / dpr,
  };
}

/** One tile of a path or floor, `w` by `h` CSS pixels, drawn once from the sim's look. */
export function groundSprite(
  kind: GroundKind,
  w: number,
  h: number,
  dpr: number,
): HTMLCanvasElement {
  return sprite(`gnd|${kind}|${w}x${h}|${dpr}`, w * dpr, h * dpr, (c) => {
    c.scale(dpr, dpr);
    paintGround(c, kind, 0, 0, w, h);
  });
}

/** A pet as a sprite, `size` CSS pixels across: drawn once for each kind, coat, pose, and face. */
export function petSprite(
  kind: PetKind,
  coat: PetCoat,
  pose: PetPosture,
  look: PetFace,
  facing: 1 | -1,
  size: number,
  dpr: number,
): HTMLCanvasElement {
  const px = Math.max(1, Math.round(size * dpr));
  return sprite(`pet|${kind}|${coat}|${pose}|${look}|${facing}|${px}`, px, px, (c) => {
    const k = px / PET_BOX;
    if (facing === -1) {
      c.translate(px, 0);
      c.scale(-k, k);
    } else c.scale(k, k);
    drawPet(c, kind, coat, pose, look);
  });
}

/** A feeling's floating sign on its paper disc, `px` device pixels square, drawn once. */
export function iconSprite(icon: FeelingIcon, px: number): HTMLCanvasElement {
  return sprite(`icon|${icon}|${px}`, px, px, (ctx) => {
    ctx.translate(px / 2, px / 2);
    drawFeelingIcon(ctx, icon, px);
  });
}
