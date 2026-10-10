/**
 * Pictures on cards (avatars, a post's first image). Only formats the renderer draws, and only
 * sizes it can decode without a big memory spike: the Worker has 128 MB, and a 12 megapixel photo
 * is already 48 MB once decoded.
 *
 * `probeImage` is the one reader of a picture's header in the repo. The server sizes uploads with
 * it (`packages/server/src/image-size.ts`), so it reads hostile bytes: it decodes no pixels,
 * allocates nothing from a length in the file, checks every length against the file, and walks a
 * JPEG's segments once.
 */

/** Largest file embedded in a card. Bigger pictures leave the card without one. */
export const MAX_IMAGE_BYTES = 6_000_000;
/** Largest picture, in pixels, embedded in a card. */
export const MAX_IMAGE_PIXELS = 12_600_000;

type CardImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

interface Probe {
  type: CardImageType;
  /** As the file stores it: a JPEG's EXIF rotation is not applied. */
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number) => u16le(b, at) | ((b[at + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, at: number) => u16be(b, at) * 0x10000 + u16be(b, at + 2);
const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));

/**
 * The type and pixel size of a picture, from its header. Undefined for anything else, and for a
 * header that is cut short or doesn't check out. A size can still be zero or huge: the caller
 * decides what it will take.
 *
 * `exif` is called with each EXIF block a JPEG carries before its scan (the TIFF data after
 * "Exif\0\0"), in file order, for a caller that wants the rotation.
 */
export function probeImage(b: Uint8Array, exif?: (tiff: Uint8Array) => void): Probe | undefined {
  return png(b) ?? gif(b) ?? webp(b) ?? jpeg(b, exif);
}

/** The signature, then IHDR, always the first chunk: width and height, four bytes each. */
function png(b: Uint8Array): Probe | undefined {
  if (b.length < 24 || b[0] !== 0x89 || ascii(b, 1, 4) !== "PNG") return undefined;
  if (ascii(b, 12, 16) !== "IHDR") return undefined;
  return { type: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
}

/** The logical screen size right after "GIF87a" or "GIF89a". */
function gif(b: Uint8Array): Probe | undefined {
  if (b.length < 10 || ascii(b, 0, 4) !== "GIF8") return undefined;
  return { type: "image/gif", width: u16le(b, 6), height: u16le(b, 8) };
}

/** The first chunk says: VP8X (extended, the canvas), VP8L (lossless), or VP8 (lossy). */
function webp(b: Uint8Array): Probe | undefined {
  if (b.length < 25 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 12) !== "WEBP") return undefined;
  const type = "image/webp";
  const chunk = ascii(b, 12, 16);
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return undefined;
    const bits = u16le(b, 21) + u16le(b, 23) * 0x10000;
    return { type, width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (b.length < 30) return undefined;
  if (chunk === "VP8X") return { type, width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined;
    return { type, width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return undefined;
}

/** Start-of-frame markers, which carry the size. C4, C8, and CC share the range but aren't frames. */
const isFrame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/**
 * Walk the segments to the scan, keeping the first frame header. Every step moves forward by at
 * least one byte and every length is checked against the file, so a hostile file costs one pass
 * at most. A segment that breaks before the scan leaves the whole file unread.
 */
function jpeg(b: Uint8Array, exif?: (tiff: Uint8Array) => void): Probe | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let frame: Probe | undefined;
  let i = 2;
  // An EXIF segment can come after the frame header (the server's stripper writes it just before
  // the scan), so the walk goes on to the scan instead of stopping at the frame.
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1] ?? 0;
    // Fill bytes: a marker may be padded with extra 0xFF.
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return frame;
    const length = u16be(b, i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > b.length) return undefined;
    if (marker === 0xe1 && ascii(b, i + 4, i + 10) === "Exif\0\0") {
      exif?.(b.subarray(i + 10, end));
    }
    if (isFrame(marker) && !frame) {
      if (length < 7) return undefined;
      frame = { type: "image/jpeg", width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    i = end;
  }
  return frame;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * A picture as a data URI a card can draw, or undefined when it isn't a format the renderer
 * draws, is too big to decode safely, or its header lies about its size.
 */
export function imageDataUri(bytes: Uint8Array): string | undefined {
  if (bytes.length > MAX_IMAGE_BYTES) return undefined;
  const probe = probeImage(bytes);
  if (!probe || probe.width < 1 || probe.height < 1) return undefined;
  if (probe.width * probe.height > MAX_IMAGE_PIXELS) return undefined;
  return `data:${probe.type};base64,${base64(bytes)}`;
}
