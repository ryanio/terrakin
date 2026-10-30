/**
 * Zooming the 2D map: how close and how far the camera may go, what a pinch or a wheel turn does
 * to it, and how much the map draws at a scale. Pure and tested (`map-zoom.test.ts`); `world.ts`
 * reads the gestures and `render.ts` asks `mapDetail` what to draw.
 */
import type { Camera } from "./camera";

/** How much closer than the usual view the map goes. */
const CLOSE_ZOOM = 1.6;
/** How much one tap on + or - zooms. */
const ZOOM_STEP = 1.6;
/** The overview leaves this much of the screen around the world, so its shores show. */
const OVERVIEW_FIT = 0.94;

/** The range a scale keeps to: the overview at `min`, the close view at `max`. */
export interface ZoomBounds {
  /** Pixels per tile with the whole world on screen. */
  min: number;
  /** The usual view, about 13 tiles across (`fitScale`). */
  base: number;
  /** The close view. */
  max: number;
}

/**
 * How far out and in the map zooms on a screen this size: out until the whole world fits, in to
 * `CLOSE_ZOOM` times the usual view. A world small enough to fit at the usual view zooms no
 * further out than it.
 */
export function zoomBounds(
  view: { width: number; height: number },
  world: { width: number; height: number },
  base: number,
): ZoomBounds {
  const fit = Math.min(view.width / world.width, view.height / world.height) * OVERVIEW_FIT;
  return { min: Math.min(base, fit), base, max: base * CLOSE_ZOOM };
}

/** A scale kept inside the bounds. */
export function clampScale(scale: number, b: ZoomBounds): number {
  return Math.min(b.max, Math.max(b.min, scale));
}

/**
 * The next scale for a tap on + (`dir` 1) or - (`dir` -1): one `ZOOM_STEP`, landing on the usual
 * view when a step passes it, so a few taps always find the way back to it.
 */
export function zoomStep(scale: number, dir: 1 | -1, b: ZoomBounds): number {
  const next = dir > 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP;
  const passes = dir > 0 ? scale < b.base && next > b.base : scale > b.base && next < b.base;
  return clampScale(passes ? b.base : next, b);
}

/**
 * Where the camera's middle goes when the map zooms to `scale` around a point on the screen
 * (`sx`, `sy`, CSS pixels), so the tile under a pinch or the mouse stays under it.
 */
export function zoomAround(
  cam: Camera,
  scale: number,
  sx: number,
  sy: number,
): { cx: number; cy: number } {
  const dx = sx - cam.width / 2;
  const dy = sy - cam.height / 2;
  return {
    cx: cam.cx + dx / cam.scale - dx / scale,
    cy: cam.cy + dy / cam.scale - dy / scale,
  };
}

/**
 * Where the camera's middle may be, so the world never slides off the screen: on an axis the view
 * is wider than the world, the world sits in the middle; on one it isn't, the view stays over the
 * world. Tiles run from -0.5 to `width - 0.5`, since a tile's middle is its coordinate.
 */
export function keepInWorld(
  cam: Camera,
  world: { width: number; height: number },
): { cx: number; cy: number } {
  const axis = (c: number, view: number, size: number) => {
    const half = view / cam.scale / 2;
    const middle = (size - 1) / 2;
    if (half * 2 >= size) return middle;
    return Math.min(size - 0.5 - half, Math.max(-0.5 + half, c));
  };
  return {
    cx: axis(cam.cx, cam.width, world.width),
    cy: axis(cam.cy, cam.height, world.height),
  };
}

/**
 * Below this many pixels a tile, the map skips what is too small to see (tufts, flowers, things
 * lying about, furniture's own art, figures' faces) and draws blocks as plain fills.
 */
const SIMPLE_BELOW = 14;
/** Below this many pixels a tile, the map names each land and marks the halls, shops, and home. */
const MARKS_BELOW = 20;

/** What the map draws at a scale. */
export interface MapDetail {
  /** Blocks as plain fills, and none of the small things. */
  simple: boolean;
  /** Land names, hall and shop marks, and your home's pin. */
  marks: boolean;
}

export function mapDetail(scale: number): MapDetail {
  return { simple: scale < SIMPLE_BELOW, marks: scale < MARKS_BELOW };
}

/**
 * The scale the map draws at: whole pixels from the simple view up, so a pinch redraws each
 * figure's and block's sprite once a pixel rather than every frame, and quarter pixels below,
 * where a pixel is a big step and nothing is drawn from a sprite.
 */
export function drawnScale(scale: number): number {
  return scale >= SIMPLE_BELOW ? Math.round(scale) : Math.round(scale * 4) / 4;
}
