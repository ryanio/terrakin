/**
 * The zoomed-out map's ground (`mapDetail(scale).simple`): the whole world as one small picture,
 * a pixel a tile, in each tile's ground, sea, bridge, path, or ground-floor block color. The map
 * stretches it over the screen in one draw, where tile by tile it would be thousands of fills a
 * frame. It is drawn again only when something it shows changes (`Mirror.groundRev`) or the
 * season turns.
 */
import { drawnLook, groundTile, POND_LOOK, SEA_LOOK, type Season, tileKey } from "@terrakin/sim";
import type { Mirror } from "../mirror";
import { blockColor } from "./palette";

const pictures = new WeakMap<Mirror, { key: string; canvas: HTMLCanvasElement }>();

/** Colors as the bytes a pixel takes, read back through a canvas so any CSS color works. */
const bytes = new Map<string, readonly [number, number, number]>();
let reader: CanvasRenderingContext2D | null | undefined;

function rgb(color: string): readonly [number, number, number] {
  let found = bytes.get(color);
  if (found) return found;
  reader ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!reader) return [0, 0, 0];
  reader.clearRect(0, 0, 1, 1);
  reader.fillStyle = color;
  reader.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = reader.getImageData(0, 0, 1, 1).data;
  found = [r, g, b];
  bytes.set(color, found);
  return found;
}

export function groundPicture(mirror: Mirror, season: Season | undefined): HTMLCanvasElement {
  const { config, commons } = mirror;
  const { width, height, plotSize: S } = config;
  const key = `${mirror.groundRev}|${season ?? ""}|${width}x${height}`;
  const kept = pictures.get(mirror);
  if (kept?.key === key) return kept.canvas;
  const canvas = kept?.canvas ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.createImageData(width, height);
  const px = image.data;
  const water = mirror.lands !== undefined;
  const paving = mirror.drawnPaving;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tileKey(x, y);
      let color: string;
      const block = mirror.blocks.get(tile);
      if (water && mirror.isSea(x, y)) color = SEA_LOOK.water;
      else if (water && mirror.onBridge(x, y)) color = SEA_LOOK.deck;
      else if (block) color = block === "pond" ? POND_LOOK.water : blockColor(block);
      else {
        const laid = paving.get(tile);
        if (laid) color = drawnLook(laid).tone;
        else {
          const inCommons = Math.floor(x / S) === commons.px && Math.floor(y / S) === commons.py;
          color = groundTile(config, x, y, inCommons, season).fill;
        }
      }
      const [r, g, b] = rgb(color);
      const i = (y * width + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  pictures.set(mirror, { key, canvas });
  return canvas;
}
