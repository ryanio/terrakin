import { fourWayFacing } from "@terrakin/protocol";
import {
  blockFill,
  FLOWER_TONES,
  groundTile,
  HEARTH_COLOR,
  HEARTH_DOOR,
  holidayOf,
  isDecorKind,
  isFurnitureKind,
  LEAF_TONES,
  OUTSIDE_GROUND,
  PET_BOX,
  plotDistance,
  plotKey,
  type Resident,
  type Season,
  THEME_INFO,
  THEME_TINT_ALPHA,
  tileHash,
  tileKey,
  tuftStroke,
} from "@terrakin/sim";
import { FEELING_ICON, type FeelingIcon, type FigureFace, signPx } from "@terrakin/ui/figure";
import { type ArtKind, growth } from "@terrakin/ui/item-art";
import { lookImage, withAlpha } from "@terrakin/ui/looks";
import { type Camera, tileToScreen } from "./camera";
import { eventLanterns } from "./event-format";
import { type Feelings, idPhase, pose, restingPose } from "./feelings";
import type { Mirror } from "./mirror";
import { awayPose, type Motion, type Pose as MotionPose } from "./motion";
import { type Box, bubbleBox, drawBubble, drawDust, drawPoof, stackBubbles } from "./overhead";
import { lyingOn, type PetMotion, type PetScene } from "./pets";
import { type BlockSkin, paintBlock, paintCrop } from "./render/blocks";
import { drawShop, drawTownHall, tilesBox } from "./render/buildings";
import {
  leafPath,
  paintDecor,
  paintFind,
  paintLantern,
  paintPedestal,
  paintShown,
  paintTownMark,
} from "./render/decor";
import { lightBulbs } from "./render/decor-winter";
import { paintFurniture, paintGameTable } from "./render/furniture";
import { type MapGlow, mapGlow } from "./render/glow";
import { paintHover } from "./render/hover";
import { labelWidth, ownerHue, paintPlotLabels } from "./render/labels";
import { CLAY, CLAY_DEEP, INK, PAPER, PAPER_EDGE } from "./render/palette";
import {
  AWAY_TAG_ALPHA,
  figureSprite,
  groundSprite,
  iconSprite,
  petSprite,
  sprite,
} from "./render/sprites";
import { type CastMark, paintCast, paintPond } from "./render/water";
import { nightAmount } from "./time";
import { plotLabelFade } from "./visits";
import { drawWeather, type SkyAmounts, UMBRELLA_RAIN } from "./weather";

export { RESIDENT_COLOR_HEX } from "@terrakin/ui/looks";
export { blockColor } from "./render/palette";
export { faceKey } from "./render/sprites";
export { CAST_MS, type CastMark } from "./render/water";
export { HEARTH_COLOR };

export interface RenderState {
  mirror: Mirror;
  me: string | undefined;
  cam: Camera;
  buildMode: boolean;
  /** Phase of the day, 0 to 1. Absent when the server gave no time anchor. */
  dayPhase?: number;
  /** What each figure feels, at `now` (milliseconds). Without it every face is neutral. */
  feelings?: Feelings;
  /** How residents move between tiles, and what they say. */
  motion: Motion;
  /** The frame's time, in ms. */
  now: number;
  /** Reduced motion: faces, signs, and bubbles stay; slides, bounces, blinks, and drifting go. */
  still: boolean;
  /** The world's season, for the ground. Absent: today's look. */
  season?: Season | undefined;
  /** How much cloud, rain, snow, and fog to draw (`weather.ts`). Absent: a clear sky. */
  sky?: SkyAmounts | undefined;
  /** Where pets are and what they're doing (RFC 0019). Without it no pets are drawn. */
  pets?: PetMotion;
  /** The server's clock, ms, which pets plan their days by. */
  clock?: number;
  /**
   * How far down the screen, in CSS pixels, the top bar and the visit card reach. A plot's name
   * slides down below them rather than sit under them. Absent: the top of the screen.
   */
  labelTop?: number;
  /** Casts made lately (RFC 0023), drawn on the water for a moment. */
  casts?: readonly CastMark[];
  /** The tiles a click would act on, under a mouse pointer, ringed. Absent: nothing is. */
  hover?: readonly { x: number; y: number }[] | undefined;
}

/** A pet's box across, in tiles: about half a resident's height. */
const PET_TILES = 1;
/** Where a pet's feet are in its box, from the top, out of `PET_BOX`. */
const PET_FEET = 42.5;

/** Reused every frame, so drawing figures allocates nothing. */
const posed = restingPose();
const face: FigureFace = {};

export function render(
  ctx: CanvasRenderingContext2D,
  {
    mirror,
    me,
    cam,
    buildMode,
    dayPhase,
    feelings,
    motion,
    now,
    still,
    season,
    sky,
    pets,
    clock,
    labelTop = 0,
    casts,
    hover,
  }: RenderState,
) {
  const { width, height, scale } = cam;
  const { config, commons } = mirror;
  const S = config.plotSize;
  ctx.fillStyle = OUTSIDE_GROUND;
  ctx.fillRect(0, 0, width, height);

  // Visible tile range.
  const x0 = Math.max(0, Math.floor(cam.cx - width / scale / 2) - 1);
  const x1 = Math.min(config.width - 1, Math.ceil(cam.cx + width / scale / 2) + 1);
  const y0 = Math.max(0, Math.floor(cam.cy - height / scale / 2) - 1);
  const y1 = Math.min(config.height - 1, Math.ceil(cam.cy + height / scale / 2) + 1);
  const half = scale / 2;

  // ---- ground: one fillRect per tile, edges rounded so neighbors share pixels (no seams) ----
  const dpr = ctx.getTransform().a || 1;
  const paved = mirror.paving.size > 0;
  const tufts = new Path2D();
  const flowers: [Path2D, Path2D] = [new Path2D(), new Path2D()];
  const leaves: [Path2D, Path2D, Path2D] = [new Path2D(), new Path2D(), new Path2D()];
  // Phase 1 gathering: fallen branches and loose stones, from the sim's own spawn function, and
  // finds (RFC 0021), each drawn as its own picture once the ground is down.
  const sticks = new Path2D();
  const pebbles = new Path2D();
  const finds: { kind: ArtKind; cx: number; cy: number; size: number }[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const { sx, sy } = tileToScreen(cam, x, y);
      const left = Math.round(sx - half);
      const top = Math.round(sy - half);
      const w = Math.round(sx + half) - left;
      const h = Math.round(sy + half) - top;
      const inCommons = Math.floor(x / S) === commons.px && Math.floor(y / S) === commons.py;
      // Tone and scenery come from the sim's palette, shared with the plot photos.
      const ground = groundTile(config, x, y, inCommons, season);
      ctx.fillStyle = ground.fill;
      ctx.fillRect(left, top, w, h);
      // A path or floor (RFC 0016) covers the tile's own grass: drawn once per size, then stamped.
      const laid = paved ? mirror.paving.get(tileKey(x, y)) : undefined;
      if (laid) ctx.drawImage(groundSprite(laid, w, h, dpr), left, top, w, h);
      const deco = laid ? null : ground.scenery;
      if (deco?.kind === "tuft") {
        // A little tuft of grass.
        const bx = left + w * deco.fx;
        const by = top + h * 0.72;
        tufts.moveTo(bx - w * 0.08, by);
        tufts.lineTo(bx - w * 0.12, by - h * 0.14);
        tufts.moveTo(bx, by);
        tufts.lineTo(bx, by - h * 0.2);
        tufts.moveTo(bx + w * 0.08, by);
        tufts.lineTo(bx + w * 0.13, by - h * 0.13);
      } else if (deco?.kind === "flower") {
        const fx = left + w * deco.fx;
        const fy = top + h * deco.fy;
        const path = flowers[deco.tone] as Path2D;
        path.moveTo(fx + scale * 0.06, fy);
        path.arc(fx, fy, scale * 0.06, 0, Math.PI * 2);
      } else if (deco?.kind === "leaf") {
        // A fallen leaf: two curves from tip to tip, as the plot photos draw it.
        leafPath(leaves[deco.tone] as Path2D, left + w * deco.fx, top + h * deco.fy, deco.turn, w);
      }
      const pickup = mirror.pickupAt(x, y);
      if (pickup) {
        const px = left + w * 0.5;
        const py = top + h * 0.55;
        if (pickup === "wood") {
          // A fallen branch: two crossed sticks.
          sticks.moveTo(px - w * 0.13, py + h * 0.07);
          sticks.lineTo(px + w * 0.13, py - h * 0.07);
          sticks.moveTo(px - w * 0.1, py - h * 0.09);
          sticks.lineTo(px + w * 0.11, py + h * 0.1);
        } else if (pickup === "stone") {
          // A loose stone: one low pebble.
          pebbles.moveTo(px + scale * 0.12, py);
          pebbles.ellipse(px, py, scale * 0.12, scale * 0.085, 0, 0, Math.PI * 2);
        } else {
          finds.push({ kind: pickup, cx: px, cy: top + h * 0.5, size: Math.min(w, h) });
        }
      }
    }
  }
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, scale / 24);
  ctx.strokeStyle = tuftStroke(season);
  ctx.stroke(tufts);
  ctx.fillStyle = FLOWER_TONES[0];
  ctx.fill(flowers[0]);
  ctx.fillStyle = FLOWER_TONES[1];
  ctx.fill(flowers[1]);
  for (const [i, path] of leaves.entries()) {
    ctx.fillStyle = LEAF_TONES[i] as string;
    ctx.fill(path);
  }
  // Pickups sit on ground of their own color (forest, stone), so each gets a soft ink edge.
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(3, scale / 8);
  ctx.stroke(sticks);
  ctx.lineWidth = Math.max(1, scale / 24);
  ctx.stroke(pebbles);
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1.5, scale / 14);
  ctx.strokeStyle = blockFill("wood");
  ctx.stroke(sticks);
  ctx.fillStyle = blockFill("stone");
  ctx.fill(pebbles);
  for (const f of finds) paintFind(ctx, f.kind, f.cx, f.cy, f.size);

  // ---- plots: owner tint plus a dashed clay border; faint lines between unclaimed plots ----
  const px0 = Math.floor(x0 / S);
  const px1 = Math.floor(x1 / S);
  const py0 = Math.floor(y0 / S);
  const py1 = Math.floor(y1 / S);
  const plotPx = S * scale;
  // Named plots near you, or every one on a map drawn big (decision 0121), labelled after the
  // night so they stay readable.
  const here = { x: Math.round(cam.cx), y: Math.round(cam.cy) };
  const plotLabels: { text: string; left: number; top: number; fade: number; mine: boolean }[] = [];
  for (let py = py0; py <= py1; py++) {
    for (let px = px0; px <= px1; px++) {
      const { sx, sy } = tileToScreen(cam, px * S, py * S);
      const left = Math.round(sx - half);
      const top = Math.round(sy - half);
      const owner = mirror.plots.get(plotKey(px, py));
      const named = owner ? mirror.plotNames.get(plotKey(px, py)) : undefined;
      const fade = named ? plotLabelFade(plotDistance(config, here, px, py), scale) : 0;
      if (named && fade > 0) {
        plotLabels.push({ text: named, left, top, fade, mine: owner === me });
      }
      const isCommons = px === commons.px && py === commons.py;
      ctx.setLineDash([]);
      if (owner) {
        const mine = owner === me;
        const theme = mirror.residents.get(owner)?.theme;
        // A theme tints the whole plot; otherwise a stable hue per owner tells neighbors apart.
        ctx.fillStyle = theme
          ? withAlpha(THEME_INFO[theme].palette.ground, THEME_TINT_ALPHA)
          : mine
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
  // Blocks on a themed plot (or one with its owner's own pattern) are drawn once into a sprite.
  const inset = Math.max(1, Math.round(scale * 0.05));
  const lip = Math.max(2, Math.round(scale * 0.16));
  const skins = new Map<string, BlockSkin | null>();
  const skinOf = (owner: string | undefined): BlockSkin | null => {
    if (!owner) return null;
    let skin = skins.get(owner);
    if (skin === undefined) {
      const r = mirror.residents.get(owner);
      const image = lookImage(r?.patternMedia);
      skin =
        r?.theme || image
          ? {
              ...(r?.theme ? { theme: r.theme, palette: THEME_INFO[r.theme].palette } : {}),
              ...(image && r?.patternMedia ? { image, imageId: r.patternMedia } : {}),
            }
          : null;
      skins.set(owner, skin);
    }
    return skin;
  };
  /** Lanterns, lamps, flames, and cauldrons' brews on screen, which glow after dark. */
  const lanterns: { sx: number; sy: number; tint: MapGlow["tint"] }[] = [];
  /** The bulbs of strings of lights on screen, which glow their own colors after dark. */
  const bulbs: { x: number; y: number; color: string }[] = [];
  // Ponds (RFC 0023) lie flat in the ground, each tile's bank only where no pond runs on, with
  // any cast on them drawn before the blocks and figures.
  const isPond = (x: number, y: number) => mirror.blocks.get(tileKey(x, y)) === "pond";
  for (const [key, block] of mirror.blocks) {
    if (block !== "pond") continue;
    const [x, y] = key.split(",").map(Number) as [number, number];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const { sx, sy } = tileToScreen(cam, x, y);
    const left = Math.round(sx - half);
    const top = Math.round(sy - half);
    const open = {
      n: !isPond(x, y - 1),
      e: !isPond(x + 1, y),
      s: !isPond(x, y + 1),
      w: !isPond(x - 1, y),
    };
    paintPond(
      ctx,
      left,
      top,
      Math.round(sx + half) - left,
      Math.round(sy + half) - top,
      open,
      tileHash(x, y),
      now,
      still,
    );
    if (mirror.townBuilt.has(key)) {
      paintTownMark(ctx, left + inset, top + inset, Math.round(scale) - inset * 2, scale);
    }
  }
  for (const c of casts ?? []) {
    if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
    const { sx, sy } = tileToScreen(cam, c.x, c.y);
    paintCast(ctx, c, sx, sy, scale, now, still);
  }
  const isFence = (x: number, y: number) => mirror.blocks.get(tileKey(x, y)) === "fence";
  const isWall = (x: number, y: number) => mirror.blocks.get(tileKey(x, y)) === "stone_wall";
  for (const [key, block] of mirror.blocks) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const { sx, sy } = tileToScreen(cam, x, y);
    const left = Math.round(sx - half) + inset;
    const top = Math.round(sy - half) + inset;
    const size = Math.round(scale) - inset * 2;
    // Drawn flat with the ground, above.
    if (block === "pond") continue;
    // A pedestal is a little plinth; whatever's on display stands on it (RFC 0005 step 3).
    if (block === "pedestal") {
      paintPedestal(ctx, left, top, size, scale);
      const shown = mirror.displays.get(key)?.good ?? mirror.shownFinds.get(key);
      if (shown) paintShown(ctx, shown, left, top, size, "pedestal");
      continue;
    }
    // Furniture from the workbench (RFC 0016): its own picture, standing on the tile.
    if (isFurnitureKind(block)) {
      const joins = {
        n: isWall(x, y - 1),
        e: isWall(x + 1, y),
        s: isWall(x, y + 1),
        w: isWall(x - 1, y),
      };
      paintFurniture(ctx, block, left, top, size, scale, inset, joins);
      if (mirror.townBuilt.has(key)) paintTownMark(ctx, left, top, size, scale);
      // Lamp posts, campfires, and a jack-o'-lantern's face light up after dark.
      const lit = mapGlow(block);
      if (lit) lanterns.push({ sx: left + size * lit.x, sy: top + size * lit.y, tint: lit.tint });
      continue;
    }
    if (isDecorKind(block)) {
      const joins = {
        n: isFence(x, y - 1),
        e: isFence(x + 1, y),
        s: isFence(x, y + 1),
        w: isFence(x - 1, y),
      };
      paintDecor(ctx, block, left, top, size, scale, inset, joins);
      // A frame shows what hangs in it in place of its own little landscape.
      const shown =
        block === "frame"
          ? (mirror.displays.get(key)?.good ?? mirror.shownFinds.get(key))
          : undefined;
      if (shown) paintShown(ctx, shown, left, top, size, "frame");
      if (mirror.townBuilt.has(key)) paintTownMark(ctx, left, top, size, scale);
      // A paper lantern's shade and a cauldron's brew light up after dark.
      const lit = mapGlow(block);
      if (lit) lanterns.push({ sx: left + size * lit.x, sy: top + size * lit.y, tint: lit.tint });
      if (block === "string_lights") bulbs.push(...lightBulbs(left, top, size));
      continue;
    }
    const skin = block === "glass" ? null : skinOf(mirror.ownerAt(x, y));
    if (!skin) paintBlock(ctx, block, left, top, size, scale);
    else {
      const w = size + 2;
      const h = size + lip + 2;
      const art = sprite(
        `blk|${block}|${skin.theme ?? ""}|${skin.imageId ?? ""}|${size}|${scale.toFixed(2)}|${dpr}`,
        w * dpr,
        h * dpr,
        (c) => {
          c.scale(dpr, dpr);
          paintBlock(c, block, 0, 0, size, scale, skin);
        },
      );
      ctx.drawImage(art, left, top, w, h);
    }
    // Something growing in a planter: drawn from the world's day, so it grows at midnight UTC.
    const planting = block === "planter" ? mirror.crops.get(key) : undefined;
    if (planting) {
      paintCrop(
        ctx,
        planting.crop,
        growth(planting.plantedDay, planting.readyDay, mirror.day),
        left,
        top,
        size,
      );
    }
    if (mirror.townBuilt.has(key)) paintTownMark(ctx, left, top, size, scale);
  }

  drawTownHall(ctx, mirror, cam);
  drawShop(ctx, mirror, cam);

  // ---- events (RFC 0010): a lantern on an event's plot on its day, lit while it's on ----
  for (const l of eventLanterns(mirror.events.values(), {
    plotSize: S,
    day: mirror.day,
    taken: (x, y) =>
      mirror.blocks.has(tileKey(x, y)) || mirror.isTownHall(x, y) || mirror.isShop(x, y),
  })) {
    if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
    const { sx, sy } = tileToScreen(cam, l.x, l.y);
    const left = Math.round(sx - half) + inset;
    const top = Math.round(sy - half) + inset;
    const size = Math.round(scale) - inset * 2;
    const shade = { sx: left + size * 0.64, sy: top + size * 0.42, tint: "warm" as const };
    // Lit, it glows in daylight too, and joins the paper lanterns that glow after dark.
    if (l.lit) {
      const g = ctx.createRadialGradient(shade.sx, shade.sy, 0, shade.sx, shade.sy, scale * 0.9);
      g.addColorStop(0, "rgba(255, 206, 110, 0.55)");
      g.addColorStop(1, "rgba(255, 196, 92, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(shade.sx - scale, shade.sy - scale, scale * 2, scale * 2);
      lanterns.push(shade);
    }
    paintLantern(ctx, left, top, size);
  }

  // ---- game tables (RFC 0011): a table with a die on it, glowing while a game plays ----
  for (const t of mirror.tables.values()) {
    if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
    const { sx, sy } = tileToScreen(cam, t.x, t.y);
    const left = Math.round(sx - half) + inset;
    const top = Math.round(sy - half) + inset;
    const size = Math.round(scale) - inset * 2;
    paintGameTable(ctx, left, top, size, scale, inset, t.playing);
  }

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
    ctx.fillStyle = HEARTH_DOOR;
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

  // ---- home pictures: a resident's own art of their home, standing over their hearth ----
  for (const [key, owner] of mirror.plots) {
    const r = mirror.residents.get(owner);
    const img = lookImage(r?.homeArt);
    if (!r?.homeArt || !img) continue;
    const [px, py] = key.split(",").map(Number) as [number, number];
    const onPlot =
      r.hearth && Math.floor(r.hearth.x / S) === px && Math.floor(r.hearth.y / S) === py;
    const middle = Math.floor((S - 1) / 2);
    const anchor = onPlot && r.hearth ? r.hearth : { x: px * S + middle, y: py * S + middle };
    const { sx, sy } = tileToScreen(cam, anchor.x, anchor.y);
    const max = scale * Math.min(3.6, S - 1);
    const fit = Math.min(max / img.naturalWidth, max / img.naturalHeight);
    const w = img.naturalWidth * fit;
    const h = img.naturalHeight * fit;
    const bottom = sy + half * 0.95;
    if (sx + w / 2 < 0 || sx - w / 2 > width || bottom < 0 || bottom - h > height) continue;
    ctx.fillStyle = "rgba(74, 52, 28, 0.22)";
    ctx.beginPath();
    ctx.ellipse(sx, bottom, w * 0.42, Math.max(3, scale * 0.16), 0, 0, Math.PI * 2);
    ctx.fill();
    const art = sprite(`home|${r.homeArt}|${Math.round(w)}|${dpr}`, w * dpr, h * dpr, (c) =>
      c.drawImage(img, 0, 0, w * dpr, h * dpr),
    );
    ctx.drawImage(art, sx - w / 2, bottom - h, w, h);
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

  if (hover) paintHover(ctx, cam, hover);

  // ---- pets: beside their owners, or at home by the hearth (RFC 0019), under the residents ----
  if (pets) {
    const scene: PetScene = {
      now,
      clock: clock ?? now,
      night: dayPhase !== undefined && nightAmount(dayPhase) > 0.55,
      still,
      ground: mirror.ground(),
      config,
      day: mirror.day,
      lying: lyingOn(mirror.asleep(me)),
    };
    const size = scale * PET_TILES;
    const drawn = new Set<string>();
    for (const r of mirror.residents.values()) {
      if (!r.pet) continue;
      // Pets keep within a few tiles of their owner or their hearth: skip the ones far off screen.
      const anchor = r.online ? r : r.hearth;
      if (
        !anchor ||
        anchor.x < x0 - 4 ||
        anchor.x > x1 + 4 ||
        anchor.y < y0 - 4 ||
        anchor.y > y1 + 4
      )
        continue;
      const m = r.online ? motion.pose(r, now, still) : undefined;
      const p = pets.pose(r, {
        ...scene,
        drawn: m && { x: m.x, y: m.y },
      });
      if (!p) continue;
      drawn.add(r.id);
      const { sx, sy } = tileToScreen(cam, p.x, p.y);
      if (sx < -size || sy < -size || sx > width + size || sy > height + size) continue;
      const feet = sy + scale * 0.32;
      const art = petSprite(
        r.pet.kind,
        r.pet.coat,
        p.asleep ? "asleep" : "awake",
        p.happy ? "happy" : "open",
        p.facing,
        size,
        dpr,
      );
      // Breathing, slow and soft asleep.
      const breath = p.asleep && !still ? 1 + Math.sin(now / 700 + sx * 0.01) * 0.025 : 1;
      const top = feet - p.lift * scale - (size * PET_FEET * breath) / PET_BOX;
      ctx.drawImage(art, sx - size / 2, top, size, size * breath);
      if (p.asleep && !still) {
        // Little "z"s drifting up from a sleeping pet.
        const t = (((now / 2400 + (sx + sy) * 0.003) % 1) + 1) % 1;
        ctx.globalAlpha = Math.sin(Math.PI * t) * 0.7;
        ctx.fillStyle = PAPER;
        ctx.strokeStyle = "rgba(43, 38, 32, 0.55)";
        ctx.lineWidth = Math.max(1, scale / 30);
        ctx.font = `700 ${Math.round(scale * (0.16 + t * 0.08))}px "Figtree Variable", system-ui, sans-serif`;
        const zx = sx + p.facing * size * (0.12 + t * 0.1);
        const zy = feet - size * (0.48 + t * 0.32);
        ctx.strokeText("z", zx, zy);
        ctx.fillText("z", zx, zy);
        ctx.globalAlpha = 1;
      }
      if (p.heart !== undefined) {
        // A heart floats up after a pat.
        const px = Math.round(signPx(scale) * 0.8);
        ctx.globalAlpha = Math.min(1, (1 - p.heart) * 3);
        ctx.drawImage(
          iconSprite("heart", Math.round(px * dpr)),
          sx - px / 2,
          feet - size * 0.85 - px - p.heart * scale * 0.5,
          px,
          px,
        );
        ctx.globalAlpha = 1;
      }
    }
    pets.keep(drawn);
  }

  // ---- residents: little figures in their looks, each a cached sprite, north to south ----
  const labels: {
    text: string;
    x: number;
    y: number;
    mine: boolean;
    top?: number;
    /** A resident's tag: what they say goes over it. */
    who?: string;
    /** The feeling's sign over the tag, how faded it is, and how far it has drifted up. */
    icon?: FeelingIcon | undefined;
    fade?: number;
    rise?: number;
    /** Away, asleep at home or out on a routine: the tag and sign are drawn fainter, beside. */
    away?: boolean;
  }[] = [];
  const hall = tilesBox(mirror.townHall, cam);
  if (hall)
    labels.push({ text: "Town Hall", x: hall.left + hall.w / 2, y: hall.top - 2, mine: false });
  const shop = tilesBox(mirror.shop, cam);
  if (shop) labels.push({ text: "Shop", x: shop.left + shop.w / 2, y: shop.top - 2, mine: false });
  // `m` is how they move between tiles (`motion.ts`); `p` below is their face (`feelings.ts`).
  // `away` is someone away from the world; `out`, someone away out on a routine (decision 0083).
  const shown: { r: Resident; m: MotionPose; away: boolean; out: boolean }[] = [];
  const walking = new Set<string>();
  const onScreen = (m: MotionPose) => {
    const { sx, sy } = tileToScreen(cam, m.x, m.y);
    return sx >= -scale && sy >= -scale && sx <= width + scale && sy <= height + scale * 1.5;
  };
  for (const r of mirror.residents.values()) {
    if (!r.online) continue;
    walking.add(r.id);
    const m = motion.pose(r, now, still);
    if (onScreen(m)) shown.push({ r, m, away: false, out: false });
  }
  // Away and out on a routine (decision 0083): where they are, walking its steps, awake but faded.
  for (const { r } of mirror.outOnRoutine(me)) {
    walking.add(r.id);
    const m = motion.pose(r, now, still);
    if (onScreen(m)) shown.push({ r, m, away: true, out: true });
  }
  motion.keep(walking);
  // Residents who are away sleep at their hearths, faded (decision 0086). Drawn, never counted.
  for (const d of mirror.asleep(me)) {
    const m = awayPose(d.r.id, d.x, d.y, now, still);
    if (onScreen(m)) shown.push({ r: d.r, m, away: true, out: false });
  }
  shown.sort((a, b) => a.m.y - b.m.y || a.m.x - b.m.x);
  // Umbrellas go up in the rain and are carried rolled up otherwise.
  const raining = (sky?.rain ?? 0) >= UMBRELLA_RAIN;
  for (const { r, m, away, out } of shown) {
    const { sx, sy } = tileToScreen(cam, m.x, m.y);
    const feet = sy + scale * 0.38;
    const mine = r.id === me;
    if (mine) {
      ctx.fillStyle = "rgba(242, 184, 75, 0.45)";
      ctx.beginPath();
      ctx.ellipse(sx, feet - scale * 0.02, scale * 0.42, scale * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // The shadow stays on the ground and shrinks as they hop.
    const shade = Math.max(0.5, 1 - m.lift * 2.5) * (away ? 0.6 : 1);
    ctx.fillStyle = `rgba(60, 40, 20, ${(0.24 * shade).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(sx, feet, scale * 0.27 * shade, scale * 0.085 * shade, 0, 0, Math.PI * 2);
    ctx.fill();
    if (m.poof !== undefined) drawPoof(ctx, sx, feet, scale, m.poof);
    if (m.dust) {
      const at = tileToScreen(cam, m.dust.x, m.dust.y);
      drawDust(ctx, at.sx, at.sy + scale * 0.38, scale, m.dust.t);
    }
    // The face of the moment: a feeling, a blink, a wave, a bounce (RFC 0013). Dozing is `sleepy`;
    // someone out on a routine is awake.
    const doze = out ? undefined : m.doze;
    const p = pose(feelings?.get(r.id, now) ?? doze, now, idPhase(r.id), still, posed);
    face.feeling = p.feeling;
    face.blink = p.blink;
    face.wave = p.wave;
    // Out in the rain an umbrella goes up; asleep at home it stays rolled up beside them.
    const asleep = away && !out;
    face.furled = (asleep || !raining) && (r.wear?.includes("umbrella") ?? false);
    // The way they're walking, or the server's word for someone who hasn't moved since. Asleep
    // at home, they face out of the door (`awayPose`).
    const facing = m.facing ?? mirror.facing.get(r.id) ?? "s";
    const turned = fourWayFacing(facing);
    const side = turned === "e" ? 1 : turned === "w" ? -1 : 0;
    const fig = figureSprite(r, scale, dpr, facing, face, away);
    const ground = feet - (p.lift + m.lift) * scale;
    // Leaning, swaying, and squashing from the feet.
    ctx.save();
    ctx.translate(sx, ground);
    ctx.rotate(p.tilt * 0.5 + m.sway + m.lean * side);
    ctx.scale(m.squash, 1 / m.squash);
    ctx.drawImage(fig.canvas, fig.dx, fig.dy, fig.w, fig.h);
    ctx.restore();
    labels.push({
      text: r.kind === "agent" ? `${r.name} ⚙` : r.name,
      x: sx,
      y: feet + fig.dy - 1,
      mine,
      who: r.id,
      // Out on a routine, a small moon beside the name says they're away, not here.
      icon: out ? "moon" : FEELING_ICON[p.feeling],
      fade: out ? 1 : p.fade,
      rise: out ? 0 : p.rise,
      away,
    });
  }

  // ---- the weather: cloud, mist, rain, and snow, under the night and the name tags ----
  if (sky) {
    const blocks = mirror.blocks;
    drawWeather(ctx, {
      cam,
      sky,
      now,
      still,
      open: (x, y) => !blocks.has(tileKey(x, y)),
    });
  }

  // ---- light: warm glow at dawn and dusk, dusky violet at night, hearths glow after dark ----
  if (dayPhase !== undefined) {
    const night = nightAmount(dayPhase);
    const golden = Math.sin(Math.PI * night);
    // Halloween's evenings (RFC 0022): a deeper pumpkin glow at dusk, never at dawn, and a violet
    // night. Midwinter's: a gold dusk, and lights that shine a little brighter after dark.
    const holiday = mirror.day === undefined ? undefined : holidayOf(mirror.day);
    const halloween = holiday === "halloween";
    const midwinter = holiday === "midwinter";
    const evening = dayPhase > 0.25 && dayPhase < 0.75;
    if (golden > 0.02) {
      ctx.fillStyle =
        halloween && evening
          ? `rgba(236, 120, 44, ${(0.17 * golden).toFixed(3)})`
          : midwinter && evening
            ? `rgba(250, 196, 90, ${(0.22 * golden).toFixed(3)})`
            : `rgba(242, 146, 82, ${(0.13 * golden).toFixed(3)})`;
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
      if (halloween) {
        ctx.fillStyle = `rgba(96, 36, 132, ${(0.08 * night).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }
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
    // Paper lanterns and the shop's windows light up a little before the hearths do.
    if (night > 0.15) {
      ctx.globalCompositeOperation = "lighter";
      const strength = Math.min(1, (night - 0.15) / 0.6);
      const glow = (sx: number, sy: number, reach: number, alpha: number) => {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, reach);
        g.addColorStop(0, `rgba(255, 196, 92, ${(alpha * strength).toFixed(3)})`);
        g.addColorStop(0.25, `rgba(242, 181, 68, ${(alpha * 0.55 * strength).toFixed(3)})`);
        g.addColorStop(1, "rgba(242, 170, 80, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(sx - reach, sy - reach, reach * 2, reach * 2);
      };
      const bright = midwinter ? 1.2 : 1;
      for (const l of lanterns) {
        if (l.tint === "warm") {
          glow(l.sx, l.sy, scale * 2 * bright, 0.62 * bright);
          continue;
        }
        // A cauldron's brew (RFC 0022): a smaller green glow off the top of the pot.
        const reach = scale * 1.3;
        const g = ctx.createRadialGradient(l.sx, l.sy, 0, l.sx, l.sy, reach);
        g.addColorStop(0, `rgba(200, 240, 168, ${(0.4 * strength).toFixed(3)})`);
        g.addColorStop(0.3, `rgba(143, 209, 106, ${(0.24 * strength).toFixed(3)})`);
        g.addColorStop(1, "rgba(143, 209, 106, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(l.sx - reach, l.sy - reach, reach * 2, reach * 2);
      }
      const box = tilesBox(mirror.shop, cam);
      if (box) {
        for (const f of [0.255, 0.745])
          glow(box.left + box.w * f, box.top + box.h * 0.7, scale * 1.1, 0.4);
      }
      // Strings of lights: a soft warm pool on the snow under each string, then each bulb.
      for (let i = 0; i + 4 < bulbs.length; i += 5) {
        const mid = bulbs[i + 2];
        if (mid) glow(mid.x, mid.y + scale * 0.2, scale * 1.3 * bright, 0.32 * bright);
      }
      ctx.globalCompositeOperation = "source-over";
      // Each bulb lit in its own color with a small halo of it, twinkling unless motion is
      // reduced. Drawn over the night, not added to it, so neighbors' colors never wash to white.
      const lit = Math.min(1, strength * bright);
      bulbs.forEach((b, i) => {
        const twinkle = still ? 1 : 0.75 + 0.25 * Math.sin(now / 480 + i * 1.9);
        const reach = scale * 0.24 * bright;
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, reach);
        g.addColorStop(0, withAlpha(b.color, 0.6 * lit * twinkle));
        g.addColorStop(1, withAlpha(b.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(b.x - reach, b.y - reach, reach * 2, reach * 2);
        ctx.fillStyle = withAlpha(b.color, lit);
        ctx.beginPath();
        ctx.arc(b.x, b.y, scale * 0.045, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = withAlpha(PAPER, 0.75 * lit * twinkle);
        ctx.beginPath();
        ctx.arc(b.x, b.y - scale * 0.01, scale * 0.02, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  // ---- plots' names, softly, along the top of each named plot near you (decision 0121) ----
  if (plotLabels.length > 0) {
    paintPlotLabels(ctx, plotLabels, { plotPx, scale, width, height, labelTop });
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
  // Nudge a tag up when it, or the sign over it, would sit on a neighbor's tag or sign, so names
  // next to each other stay legible. Someone asleep at home wears their sign beside the name
  // (`besideTag`), so neighbors asleep at one hearth keep their tags close.
  const sign = signPx(scale);
  const small = Math.round(sign * 0.8);
  const besideTag = (l: (typeof labels)[number], w: number, top: number): Box => ({
    left: l.x + w / 2 + 2,
    right: l.x + w / 2 + 2 + small,
    top: top + (tagH - small) / 2,
    bottom: top + (tagH + small) / 2,
  });
  labels.sort((a, b) => b.y - a.y || a.x - b.x);
  const placed: Box[] = [];
  const taken: Box[] = [];
  const widths: number[] = [];
  const clear = (box: Box) =>
    !taken.some(
      (t) =>
        box.left < t.right + 2 &&
        box.right > t.left - 2 &&
        box.top < t.bottom + 2 &&
        box.bottom > t.top - 2,
    );
  for (const l of labels) {
    const w = labelWidth(ctx, font, l.text) + padX * 2;
    const tagAt = (top: number): Box => ({
      left: l.x - w / 2,
      right: l.x + w / 2,
      top,
      bottom: top + tagH,
    });
    const signAt = (top: number): Box | undefined =>
      !l.icon
        ? undefined
        : l.away
          ? besideTag(l, w, top)
          : { left: l.x - sign / 2, right: l.x + sign / 2, top: top - sign - 1, bottom: top };
    let top = l.y - tagH;
    for (let tries = 0; tries < 4; tries++) {
      const over = signAt(top);
      if (clear(tagAt(top)) && (!over || clear(over))) break;
      top -= tagH + 3;
    }
    const tag = tagAt(top);
    const over = signAt(top);
    placed.push(tag);
    taken.push(tag, ...(over ? [over] : []));
    widths.push(w);
    l.top = top;
  }

  // ---- what people are saying, as text, in bubbles over their tags and signs ----
  // Bubbles stack clear of every tag and sign and of each other, the nearest speaker lowest. They
  // go down first, so a tag or sign sits on top of a raised bubble's tail.
  const avoid: Box[] = [...placed];
  const bubbles: { x: number; tip: number; lines: string[]; alpha: number; box: Box }[] = [];
  for (const [i, l] of labels.entries()) {
    if (l.top === undefined) continue;
    if (l.icon && l.away) avoid.push(besideTag(l, widths[i] ?? 0, l.top));
    // A bubble goes over the sign, so both show.
    const over = l.icon && !l.away ? sign + 1 + (l.rise ?? 0) * scale : 0;
    if (over)
      avoid.push({ left: l.x - sign / 2, right: l.x + sign / 2, top: l.top - over, bottom: l.top });
    const said = l.who && motion.bubble(l.who, now);
    if (!said) continue;
    const tip = l.top - 4 - over;
    const box = bubbleBox(ctx, l.x, tip, said.lines, fontSize, font, width);
    bubbles.push({ x: l.x, tip, lines: said.lines, alpha: said.alpha, box });
  }
  const raises = stackBubbles(
    bubbles.map((b) => b.box),
    avoid,
  );
  // Highest first, so a raised bubble's tail passes behind the bubbles below it.
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (b) drawBubble(ctx, b.x, b.tip, b.lines, b.alpha, fontSize, font, width, raises[i]);
  }

  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [i, l] of labels.entries()) {
    const top = l.top ?? l.y - tagH;
    const w = widths[i] ?? 0;
    ctx.globalAlpha = l.away ? AWAY_TAG_ALPHA : 1;
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
  ctx.globalAlpha = 1;

  // ---- feelings' signs over the tags ----
  // Drawn after every tag and the night, so a neighbor's tag never covers a sign.
  for (const [i, l] of labels.entries()) {
    if (!l.icon || l.top === undefined) continue;
    if (l.away) {
      // Beside the name, drifting a little, faint like the tag.
      const at = besideTag(l, widths[i] ?? 0, l.top);
      ctx.globalAlpha = (l.fade ?? 1) * AWAY_TAG_ALPHA;
      ctx.drawImage(
        iconSprite(l.icon, Math.round(small * dpr)),
        at.left,
        at.top - (l.rise ?? 0) * scale * 0.4,
        small,
        small,
      );
    } else {
      ctx.globalAlpha = l.fade ?? 1;
      ctx.drawImage(
        iconSprite(l.icon, Math.round(sign * dpr)),
        l.x - sign / 2,
        l.top - sign - 1 - (l.rise ?? 0) * scale,
        sign,
        sign,
      );
    }
    ctx.globalAlpha = 1;
  }
  ctx.textBaseline = "alphabetic";
}
