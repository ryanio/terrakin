/**
 * Pictures on cards (avatars, a post's first image). Only formats the renderer draws, and only
 * sizes it can decode without a big memory spike: the Worker has 128 MB, and a 12 megapixel photo
 * is already 48 MB once decoded.
 */

/** Largest file embedded in a card. Bigger pictures leave the card without one. */
export const MAX_IMAGE_BYTES = 6_000_000;
/** Largest picture, in pixels, embedded in a card. */
export const MAX_IMAGE_PIXELS = 12_600_000;

type CardImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

interface Probe {
  type: CardImageType;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) => u16le(b, i) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 65536 + u16be(b, i + 2);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** The type and pixel size of a picture, from its header. Undefined for anything else. */
export function probeImage(b: Uint8Array): Probe | undefined {
  if (b.length < 30) return undefined;
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") {
    return { type: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (ascii(b, 0, 4) === "GIF8") {
    return { type: "image/gif", width: u16le(b, 6), height: u16le(b, 8) };
  }
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X")
      return { type: "image/webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (chunk === "VP8 ") {
      return { type: "image/webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    }
    if (chunk === "VP8L") {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
      return {
        type: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    return undefined;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // Walk the JPEG segments to the first frame header (SOF0 to SOF15, minus DHT, JPG and DAC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined;
      const marker = b[i + 1] ?? 0;
      if (marker === 0xff) {
        i++;
        continue;
      }
      const length = u16be(b, i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { type: "image/jpeg", width: u16be(b, i + 7), height: u16be(b, i + 5) };
      }
      i += 2 + length;
    }
  }
  return undefined;
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
