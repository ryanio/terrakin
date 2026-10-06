export interface Camera {
  /** Tile at the center of the screen (can be fractional). */
  cx: number;
  cy: number;
  /** Pixels per tile. */
  scale: number;
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
}

export function tileToScreen(cam: Camera, x: number, y: number): { sx: number; sy: number } {
  return {
    sx: (x - cam.cx) * cam.scale + cam.width / 2,
    sy: (y - cam.cy) * cam.scale + cam.height / 2,
  };
}

export function screenToTile(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return {
    x: Math.floor((sx - cam.width / 2) / cam.scale + cam.cx + 0.5),
    y: Math.floor((sy - cam.height / 2) / cam.scale + cam.cy + 0.5),
  };
}

/** Pick a tile size that shows roughly `tilesAcross` tiles on the short side of the screen. */
export function fitScale(width: number, height: number, tilesAcross = 13): number {
  return Math.max(16, Math.floor(Math.min(width, height) / tilesAcross));
}
