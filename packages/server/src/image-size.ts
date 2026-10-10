import { probeImage } from "@terrakin/cards";
import type { MediaType } from "@terrakin/protocol";
import { readOrientation } from "./strip-metadata";

/** A picture's size in pixels, the way it shows (a JPEG's EXIF rotation applied). */
export interface ImageSize {
  width: number;
  height: number;
}

/** Bigger than any side we'd show. A header claiming more is broken or lying, so it's left out. */
export const MAX_IMAGE_SIDE = 100_000;

/**
 * An uploaded image's width and height, so a post can save room for the picture before it loads.
 * The header is read by `probeImage` in `packages/cards/` (no pixels decoded, a JPEG's segments
 * walked once). What an upload adds is here: the header has to be of the type the upload was
 * sniffed as, a JPEG's size is turned the way its EXIF rotation shows it, and a side of zero or
 * more than `MAX_IMAGE_SIDE` is left out. Anything it can't read gives undefined, and the upload
 * goes on without a size.
 */
export function imageSize(bytes: Uint8Array, type: MediaType): ImageSize | undefined {
  let orientation = 1;
  let probe: ReturnType<typeof probeImage>;
  try {
    // A file can carry more than one EXIF block: the last rotation that reads is the one kept.
    probe = probeImage(bytes, (tiff) => {
      orientation = readOrientation(tiff) ?? orientation;
    });
  } catch {
    return undefined;
  }
  if (!probe || probe.type !== type) return undefined;
  // Orientations 5 to 8 turn the picture a quarter, so it shows the other way round.
  const turned = orientation >= 5;
  const size = turned
    ? { width: probe.height, height: probe.width }
    : { width: probe.width, height: probe.height };
  const fits = (n: number) => Number.isInteger(n) && n > 0 && n <= MAX_IMAGE_SIDE;
  return fits(size.width) && fits(size.height) ? size : undefined;
}

/** `width` and `height` for a media view, from a stored row, when both were recorded. */
export function sizeFields(row: Record<string, unknown>): Partial<ImageSize> {
  const width = Number(row.width ?? 0);
  const height = Number(row.height ?? 0);
  return width > 0 && height > 0 ? { width, height } : {};
}
