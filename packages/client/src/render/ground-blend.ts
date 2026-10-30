/**
 * The map's ground as one soft wash rather than a grid of squares. Each visible tile's tone goes
 * into one pixel of a small canvas, and the canvas is drawn scaled up with smoothing on, so the
 * color is the tile's own at its middle and blends into its neighbors toward its edges: biomes and
 * the Commons meet in a soft edge, and the per-tile tones (`groundTile`, picked by a hash of the
 * tile) read as a gentle mottle instead of a checkerboard. One draw for the whole ground, so the
 * frame costs no more than a fill per tile did.
 */

let canvas: HTMLCanvasElement | null = null;
let pen: CanvasRenderingContext2D | null = null;
let pixels: ImageData | null = null;
const rgb = new Map<string, number>();

/** A `#rrggbb` tone as one packed number, worked out once per tone. */
function packed(hex: string): number {
  let n = rgb.get(hex);
  if (n === undefined) {
    n = Number.parseInt(hex.slice(1, 7), 16) || 0;
    rgb.set(hex, n);
  }
  return n;
}

/** A wash `cols` by `rows` tiles: set each tile's tone with `tone`, then `paint` it. */
export function groundWash(cols: number, rows: number) {
  if (!canvas || !pen) {
    canvas = document.createElement("canvas");
    pen = canvas.getContext("2d");
  }
  if (!pen) return null;
  if (canvas.width !== cols || canvas.height !== rows || !pixels) {
    canvas.width = cols;
    canvas.height = rows;
    pixels = pen.createImageData(cols, rows);
  }
  const data = pixels.data;
  const sheet = canvas;
  const ink = pen;
  const image = pixels;
  return {
    /** Tile (`i`, `j`) of the wash, from its top left, in `#rrggbb`. */
    tone(i: number, j: number, hex: string) {
      const n = packed(hex);
      const at = (j * cols + i) * 4;
      data[at] = (n >> 16) & 255;
      data[at + 1] = (n >> 8) & 255;
      data[at + 2] = n & 255;
      data[at + 3] = 255;
    },
    /** Draw it with its top left tile's top left corner at (`left`, `top`), `scale` per tile. */
    paint(ctx: CanvasRenderingContext2D, left: number, top: number, scale: number) {
      ink.putImageData(image, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(sheet, left, top, cols * scale, rows * scale);
      ctx.restore();
    },
  };
}
