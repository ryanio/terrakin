import type { MediaType } from "@terrakin/protocol";
import { stripGlb } from "./strip-glb";
import { stripMp4 } from "./strip-mp4";
import { stripWebm } from "./strip-webm";

/**
 * Remove metadata that can identify a person from an upload before it's stored (decisions 0014
 * and 0043).
 *
 * Images lose EXIF (which holds GPS location, camera serials, and timestamps), XMP, IPTC, and text
 * comments. Pixels are untouched. A JPEG keeps only its orientation, so phone photos don't come
 * out sideways. A malformed image is returned unchanged; the type check already passed.
 *
 * Videos lose location, user data, and metadata boxes (MP4) or tags, attachments, and chapters
 * (WebM), and models lose `extras`, XMP, and metadata in their textures. These are edited in place
 * without moving the media data, so the input may be changed. A video or model we can't walk comes
 * back undefined: the caller refuses it rather than storing something it couldn't check.
 */
export function stripMetadata(
  bytes: Uint8Array,
  type: Extract<MediaType, `image/${string}`>,
): Uint8Array;
export function stripMetadata(bytes: Uint8Array, type: MediaType): Uint8Array | undefined;
export function stripMetadata(bytes: Uint8Array, type: MediaType): Uint8Array | undefined {
  if (type === "video/mp4") return stripMp4(bytes);
  if (type === "video/webm") return stripWebm(bytes);
  if (type === "model/gltf-binary") return stripGlb(bytes);
  try {
    if (type === "image/jpeg") return stripJpeg(bytes);
    if (type === "image/png") return stripPng(bytes);
    if (type === "image/webp") return stripWebp(bytes);
  } catch {
    // Fall through: better to keep a file we couldn't parse than to break uploads.
  }
  return bytes;
}

/**
 * What a stripper keeps, copied into one buffer as it walks the file. It holds nothing for each
 * segment or chunk, so a file of a million tiny ones costs twice its own size in memory and no more.
 */
class Kept {
  /** Open so a stripper can change a byte it has copied. */
  readonly out: Uint8Array;
  private at = 0;

  /** `room` is how many bytes longer than the file the result may be. */
  constructor(
    private readonly file: Uint8Array,
    room = 0,
  ) {
    this.out = new Uint8Array(file.length + room);
  }

  /** Keep the file's bytes from `start` up to `end`, and say where in the result they went. */
  copy(start: number, end: number): number {
    const to = this.at;
    this.out.set(this.file.subarray(start, end), to);
    this.at += end - start;
    return to;
  }

  add(bytes: Uint8Array) {
    this.out.set(bytes, this.at);
    this.at += bytes.length;
  }

  bytes(): Uint8Array {
    return this.out.slice(0, this.at);
  }
}

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));

// ---------- JPEG ----------

/** Segments to drop: APP1 (EXIF, XMP), APP13 (IPTC), COM (comments). ICC (APP2) and Adobe (APP14) stay. */
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const kept = new Kept(b, ORIENTATION_BYTES);
  kept.copy(0, 2);
  let orientation: number | undefined;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b;
    const marker = b[i + 1] ?? 0;
    // Start of scan: the compressed image follows. Copy the rest as is.
    if (marker === 0xda) {
      // The orientation segment belongs right after SOI/APP0, but readers accept it before SOS too.
      if (orientation !== undefined) kept.add(exifWithOrientation(orientation));
      kept.copy(i, b.length);
      return kept.bytes();
    }
    const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    const end = i + 2 + length;
    if (length < 2 || end > b.length) return b;
    if (marker === 0xe1 && ascii(b, i + 4, i + 10) === "Exif\0\0") {
      orientation = readOrientation(b.subarray(i + 10, end)) ?? orientation;
    }
    if (!JPEG_DROP.has(marker)) kept.copy(i, end);
    i = end;
  }
  return b;
}

/** The EXIF orientation (1 to 8) from a TIFF block, if it's there. */
export function readOrientation(tiff: Uint8Array): number | undefined {
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

/** The orientation written back can be longer than the EXIF segment it was read from. */
const ORIENTATION_BYTES = exifWithOrientation(1).length;

// ---------- PNG ----------

/** Chunks to drop: EXIF, text of every kind, and the last-modified time. */
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Uint8Array): Uint8Array {
  const kept = new Kept(b);
  kept.copy(0, Math.min(8, b.length));
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
    if (!PNG_DROP.has(type)) kept.copy(i, end);
    i = end;
    if (type === "IEND") return kept.bytes();
  }
  return b;
}

// ---------- WebP ----------

function stripWebp(b: Uint8Array): Uint8Array {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 12) !== "WEBP") return b;
  const kept = new Kept(b);
  kept.copy(0, 12);
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, i + 4);
    // Added, never ORed: `|` is signed, so a top byte of 0x80 or more would make the size negative
    // and send `i` backward.
    const size =
      (b[i + 4] ?? 0) +
      (b[i + 5] ?? 0) * 0x100 +
      (b[i + 6] ?? 0) * 0x10000 +
      (b[i + 7] ?? 0) * 0x1000000;
    if (i + 8 + size > b.length) return b;
    // An odd chunk has a padding byte, which the last chunk of a file may lack.
    const end = Math.min(i + 8 + size + (size % 2), b.length);
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const flags = kept.copy(i, end) + 8;
      // VP8X flags announce which optional chunks exist. Clear the EXIF and XMP bits.
      if (fourcc === "VP8X" && size > 0) kept.out[flags] = (kept.out[flags] ?? 0) & ~0x0c;
    }
    i = end;
  }
  const out = kept.bytes();
  const size = out.length - 8;
  out.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], 4);
  return out;
}
