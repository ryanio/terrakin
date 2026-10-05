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
 * Read an uploaded image's width and height from its header, so a post can save room for the
 * picture before it loads. Only headers are read: no pixels are decoded, nothing is allocated,
 * and a JPEG's segments are walked once. Anything it can't read gives undefined, and the upload
 * goes on without a size.
 */
export function imageSize(bytes: Uint8Array, type: MediaType): ImageSize | undefined {
  let size: ImageSize | undefined;
  try {
    if (type === "image/png") size = png(bytes);
    else if (type === "image/gif") size = gif(bytes);
    else if (type === "image/webp") size = webp(bytes);
    else if (type === "image/jpeg") size = jpeg(bytes);
  } catch {
    return undefined;
  }
  if (!size) return undefined;
  const fits = (n: number) => Number.isInteger(n) && n > 0 && n <= MAX_IMAGE_SIDE;
  return fits(size.width) && fits(size.height) ? size : undefined;
}

/** `width` and `height` for a media view, from a stored row, when both were recorded. */
export function sizeFields(row: Record<string, unknown>): Partial<ImageSize> {
  const width = Number(row.width ?? 0);
  const height = Number(row.height ?? 0);
  return width > 0 && height > 0 ? { width, height } : {};
}

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));
const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number) => u16le(b, at) | ((b[at + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, at: number) => u16be(b, at) * 0x10000 + u16be(b, at + 2);

/** The first chunk after the signature is always IHDR: width and height, four bytes each. */
function png(b: Uint8Array): ImageSize | undefined {
  if (b.length < 24 || ascii(b, 12, 16) !== "IHDR") return undefined;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** The logical screen size right after "GIF89a". */
function gif(b: Uint8Array): ImageSize | undefined {
  if (b.length < 10 || ascii(b, 0, 3) !== "GIF") return undefined;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

/** The first chunk says: VP8X (extended, the canvas), VP8L (lossless), or VP8 (lossy). */
function webp(b: Uint8Array): ImageSize | undefined {
  if (b.length < 25 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 12) !== "WEBP") return undefined;
  const chunk = ascii(b, 12, 16);
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return undefined;
    const bits = u16le(b, 21) + u16le(b, 23) * 0x10000;
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (b.length < 30) return undefined;
  if (chunk === "VP8X") return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return undefined;
}

/** Start-of-frame markers, which carry the size. C4, C8, and CC share the range but aren't frames. */
const isFrame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/**
 * Walk the segments up to the first frame header. Every step moves forward by at least one byte
 * and every length is checked against the file, so a hostile file costs one pass at most.
 */
function jpeg(b: Uint8Array): ImageSize | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let orientation = 1;
  let frame: ImageSize | undefined;
  // Orientations 5 to 8 turn the picture a quarter, so it shows the other way round.
  const shown = (f: ImageSize) => (orientation >= 5 ? { width: f.height, height: f.width } : f);
  let i = 2;
  // The EXIF segment can come after the frame header (our own stripper writes it just before the
  // scan), so keep walking to the scan before deciding which way round the picture shows.
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1] ?? 0;
    // Fill bytes: a marker may be padded with extra 0xFF.
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return frame && shown(frame);
    const length = u16be(b, i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > b.length) return undefined;
    if (marker === 0xe1 && ascii(b, i + 4, i + 10) === "Exif\0\0") {
      orientation = readOrientation(b.subarray(i + 10, end)) ?? orientation;
    }
    if (isFrame(marker) && !frame) {
      if (length < 7) return undefined;
      frame = { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    i = end;
  }
  return frame && shown(frame);
}
