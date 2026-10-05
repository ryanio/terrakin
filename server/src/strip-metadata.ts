import type { MediaType } from "@terrakin/protocol";

/**
 * Remove metadata that can identify a person from uploaded images: EXIF (which holds GPS location,
 * camera serials, and timestamps), XMP, IPTC, and text comments. Pixels are untouched. A JPEG keeps
 * only its orientation, so phone photos don't come out sideways. Video and models pass through
 * unchanged for now (see issue on video metadata).
 *
 * Malformed files are returned unchanged rather than rejected here; the type check already passed.
 */
export function stripMetadata(bytes: Uint8Array, type: MediaType): Uint8Array {
  try {
    if (type === "image/jpeg") return stripJpeg(bytes);
    if (type === "image/png") return stripPng(bytes);
    if (type === "image/webp") return stripWebp(bytes);
  } catch {
    // Fall through: better to keep a file we couldn't parse than to break uploads.
  }
  return bytes;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));

// ---------- JPEG ----------

/** Segments to drop: APP1 (EXIF, XMP), APP13 (IPTC), COM (comments). ICC (APP2) and Adobe (APP14) stay. */
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let orientation: number | undefined;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b;
    const marker = b[i + 1] ?? 0;
    // Start of scan: the compressed image follows. Copy the rest as is.
    if (marker === 0xda) {
      if (orientation !== undefined) parts.push(exifWithOrientation(orientation));
      parts.push(b.subarray(i));
      // The orientation segment belongs right after SOI/APP0, but readers accept it before SOS too.
      return concat(parts);
    }
    const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    const end = i + 2 + length;
    if (length < 2 || end > b.length) return b;
    if (marker === 0xe1 && ascii(b, i + 4, i + 10) === "Exif\0\0") {
      orientation = readOrientation(b.subarray(i + 10, end)) ?? orientation;
    }
    if (!JPEG_DROP.has(marker)) parts.push(b.subarray(i, end));
    i = end;
  }
  return b;
}

/** The EXIF orientation (1 to 8) from a TIFF block, if it's there. */
function readOrientation(tiff: Uint8Array): number | undefined {
  const little = ascii(tiff, 0, 2) === "II";
  const u16 = (at: number) =>
    little
      ? (tiff[at] ?? 0) | ((tiff[at + 1] ?? 0) << 8)
      : ((tiff[at] ?? 0) << 8) | (tiff[at + 1] ?? 0);
  const u32 = (at: number) =>
    little ? u16(at) + u16(at + 2) * 0x10000 : u16(at) * 0x10000 + u16(at + 2);
  const ifd = u32(4);
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > tiff.length) return undefined;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

/** A minimal APP1 EXIF segment holding only the orientation tag. */
function exifWithOrientation(orientation: number): Uint8Array {
  // "Exif\0\0", TIFF header (little-endian, IFD at 8), one entry, no next IFD.
  const body = [
    ...[0x45, 0x78, 0x69, 0x66, 0, 0],
    ...[0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0],
    ...[0x01, 0x00],
    ...[0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, orientation, 0, 0, 0],
    ...[0, 0, 0, 0],
  ];
  const length = body.length + 2;
  return new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...body]);
}

// ---------- PNG ----------

/** Chunks to drop: EXIF, text of every kind, and the last-modified time. */
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const length =
      (((b[i] ?? 0) << 24) >>> 0) +
      ((b[i + 1] ?? 0) << 16) +
      ((b[i + 2] ?? 0) << 8) +
      (b[i + 3] ?? 0);
    const type = ascii(b, i + 4, i + 8);
    const end = i + 12 + length;
    if (end > b.length) return b;
    if (!PNG_DROP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  return b;
}

// ---------- WebP ----------

function stripWebp(b: Uint8Array): Uint8Array {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 12) !== "WEBP") return b;
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, i + 4);
    const size =
      (b[i + 4] ?? 0) |
      ((b[i + 5] ?? 0) << 8) |
      ((b[i + 6] ?? 0) << 16) |
      ((b[i + 7] ?? 0) * 0x1000000);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > b.length) return b;
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = b.slice(i, Math.min(end, b.length));
      // VP8X flags announce which optional chunks exist. Clear the EXIF and XMP bits.
      if (fourcc === "VP8X") chunk[8] = (chunk[8] ?? 0) & ~0x0c;
      chunks.push(chunk);
    }
    i = end;
  }
  const body = concat(chunks);
  const size = body.length + 4;
  const header = new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    size & 0xff,
    (size >> 8) & 0xff,
    (size >> 16) & 0xff,
    (size >>> 24) & 0xff,
    0x57,
    0x45,
    0x42,
    0x50,
  ]);
  return concat([header, body]);
}
