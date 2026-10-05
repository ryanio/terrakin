/**
 * Remove free-form metadata from a binary glTF (.glb) model: every `extras` object, XMP
 * extensions (`KHR_xmp_json_ld`, the older `KHR_xmp`), chunks after the binary one, and EXIF, XMP,
 * and comments in embedded JPEG, PNG, and WebP textures. `asset.copyright` and `asset.generator`
 * stay: the first is the author's attribution, the second names the exporting tool. Decision 0043
 * says why.
 *
 * The JSON chunk is rewritten only when something comes out of it. If the new JSON fits in the old
 * chunk it's written in place and padded with spaces, which glTF allows, so the binary chunk
 * doesn't move. Textures are scrubbed in place without changing their length, so no buffer view
 * moves either.
 *
 * The input may be changed in place. A file that can't be read safely comes back undefined, and
 * the upload is refused.
 */
export function stripGlb(b: Uint8Array): Uint8Array | undefined {
  try {
    return strip(b);
  } catch {
    return undefined;
  }
}

/**
 * The most JSON we'll parse. Real models have a few hundred KB at most; parsing a hostile 15 MB
 * of tiny objects could take most of a Worker's memory.
 */
export const MAX_GLB_JSON_BYTES = 2_000_000;

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (v: Json | undefined): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isIndex = (v: Json | undefined): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

function strip(b: Uint8Array): Uint8Array | undefined {
  if (b.length < 20) return undefined;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return undefined;
  if (view.getUint32(8, true) !== b.length) return undefined;
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) return undefined;
  if (jsonLength > MAX_GLB_JSON_BYTES || jsonLength > b.length - 20) return undefined;
  const jsonEnd = 20 + jsonLength;

  // The binary chunk, if there is one, comes straight after. Anything after it is dropped.
  let bin: Uint8Array | undefined;
  let end = jsonEnd;
  if (jsonEnd + 8 <= b.length && view.getUint32(jsonEnd + 4, true) === BIN_CHUNK) {
    const binLength = view.getUint32(jsonEnd, true);
    if (binLength > b.length - jsonEnd - 8) return undefined;
    bin = b.subarray(jsonEnd + 8, jsonEnd + 8 + binLength);
    end = jsonEnd + 8 + binLength;
  }

  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    b.subarray(20, jsonEnd),
  );
  const doc = JSON.parse(text) as Json;
  if (!isObject(doc)) return undefined;
  let changed = removeMetadata(doc);
  const textures = scrubTextures(doc, bin);
  if (textures === undefined) return undefined;
  changed ||= textures;

  let out = end === b.length ? b : b.subarray(0, end);
  if (changed) {
    const json = new TextEncoder().encode(JSON.stringify(doc));
    if (json.length <= jsonLength) {
      out.fill(0x20, 20, jsonEnd);
      out.set(json, 20);
    } else {
      const padded = Math.ceil(json.length / 4) * 4;
      const rebuilt = new Uint8Array(20 + padded + (end - jsonEnd));
      rebuilt.set(b.subarray(0, 20));
      rebuilt.fill(0x20, 20, 20 + padded);
      rebuilt.set(json, 20);
      rebuilt.set(b.subarray(jsonEnd, end), 20 + padded);
      new DataView(rebuilt.buffer).setUint32(12, padded, true);
      out = rebuilt;
    }
  }
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(8, out.length, true);
  return out;
}

const isXmp = (name: string) => /xmp/i.test(name);

/** Drop `extras` and XMP extensions everywhere. Iterative, so deep nesting can't overflow the stack. */
function removeMetadata(doc: JsonObject): boolean {
  let changed = false;
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    const list = doc[key];
    if (Array.isArray(list) && list.some((name) => typeof name === "string" && isXmp(name))) {
      doc[key] = list.filter((name) => !(typeof name === "string" && isXmp(name)));
      changed = true;
    }
  }
  const stack: Json[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const item of node) if (typeof item === "object" && item !== null) stack.push(item);
      continue;
    }
    if (!isObject(node)) continue;
    if ("extras" in node) {
      delete node.extras;
      changed = true;
    }
    const extensions = node.extensions;
    if (isObject(extensions)) {
      for (const name of Object.keys(extensions)) {
        if (isXmp(name)) {
          delete extensions[name];
          changed = true;
        }
      }
      if (Object.keys(extensions).length === 0) delete node.extensions;
    }
    for (const value of Object.values(node)) {
      if (typeof value === "object" && value !== null) stack.push(value);
    }
  }
  return changed;
}

/**
 * Scrub every embedded image: in the binary chunk, in a base64 `data:` buffer, or in a base64
 * `data:` image URI. True if the JSON changed, undefined if an image points somewhere impossible.
 * Images in external files aren't in the upload, so there's nothing to scrub.
 */
function scrubTextures(doc: JsonObject, bin: Uint8Array | undefined): boolean | undefined {
  const images = Array.isArray(doc.images) ? doc.images : [];
  const views = Array.isArray(doc.bufferViews) ? doc.bufferViews : [];
  const buffers = Array.isArray(doc.buffers) ? doc.buffers : [];
  const decoded = new Map<number, Uint8Array>();
  const dirty = new Set<number>();
  let changed = false;

  const bufferBytes = (index: number): Uint8Array | null | undefined => {
    const buffer = buffers[index];
    if (!isObject(buffer)) return undefined;
    if (buffer.uri === undefined) return index === 0 ? bin : undefined;
    if (typeof buffer.uri !== "string" || !buffer.uri.startsWith("data:")) return null;
    const known = decoded.get(index);
    if (known) return known;
    const bytes = fromDataUri(buffer.uri);
    if (bytes) decoded.set(index, bytes);
    return bytes;
  };

  for (const image of images) {
    if (!isObject(image)) continue;
    if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
      const bytes = fromDataUri(image.uri);
      if (!bytes) return undefined;
      if (scrubImage(bytes)) {
        image.uri = toDataUri(image.uri, bytes);
        changed = true;
      }
      continue;
    }
    if (image.bufferView === undefined) continue;
    if (!isIndex(image.bufferView)) return undefined;
    const bv = views[image.bufferView];
    if (!isObject(bv) || !isIndex(bv.buffer) || !isIndex(bv.byteLength)) return undefined;
    const offset = bv.byteOffset ?? 0;
    if (!isIndex(offset)) return undefined;
    const bytes = bufferBytes(bv.buffer);
    // An external buffer file isn't part of the upload.
    if (bytes === null) continue;
    if (!bytes || offset + bv.byteLength > bytes.length) return undefined;
    if (scrubImage(bytes.subarray(offset, offset + bv.byteLength)) && decoded.has(bv.buffer)) {
      dirty.add(bv.buffer);
    }
  }
  for (const index of dirty) {
    const buffer = buffers[index];
    const bytes = decoded.get(index);
    if (isObject(buffer) && typeof buffer.uri === "string" && bytes) {
      buffer.uri = toDataUri(buffer.uri, bytes);
      changed = true;
    }
  }
  return changed;
}

/** The bytes of a base64 `data:` URI. Undefined for any other kind. */
function fromDataUri(uri: string): Uint8Array | undefined {
  const comma = uri.indexOf(",");
  if (comma < 0 || !uri.slice(0, comma).endsWith(";base64")) return undefined;
  const binary = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toDataUri(original: string, bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `${original.slice(0, original.indexOf(",") + 1)}${btoa(binary)}`;
}

// ---------- textures, scrubbed in place ----------

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));

/**
 * Remove EXIF, XMP, IPTC, and comments from an image without changing its length, so nothing
 * around it has to move. True if anything changed. Formats we don't know, and images we can't
 * walk, are left as they are: a texture is decoded by the viewer, and a broken one just won't show.
 */
export function scrubImage(b: Uint8Array): boolean {
  if (b[0] === 0xff && b[1] === 0xd8) return scrubJpeg(b);
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return scrubPng(b);
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") {
    return scrubWebp(b);
  }
  return false;
}

/** APP1 (EXIF, XMP), APP13 (IPTC), and comments keep their markers and lengths; their bytes go. */
function scrubJpeg(b: Uint8Array): boolean {
  let changed = false;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return changed;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) return changed;
    const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    const end = i + 2 + length;
    if (length < 2 || end > b.length) return changed;
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) {
      b.fill(0, i + 4, end);
      changed = true;
    }
    i = end;
  }
  return changed;
}

/**
 * Text, EXIF, and time chunks become `voId`, a private ancillary chunk every decoder skips, with
 * zeroed data and a fresh CRC.
 */
function scrubPng(b: Uint8Array): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let changed = false;
  let i = 8;
  while (i + 12 <= b.length) {
    const length = view.getUint32(i);
    const type = ascii(b, i + 4, i + 8);
    const end = i + 12 + length;
    if (end > b.length) return changed;
    if (
      type === "eXIf" ||
      type === "tEXt" ||
      type === "zTXt" ||
      type === "iTXt" ||
      type === "tIME"
    ) {
      b.set([0x76, 0x6f, 0x49, 0x64], i + 4);
      b.fill(0, i + 8, i + 8 + length);
      view.setUint32(i + 8 + length, crc32(b.subarray(i + 4, i + 8 + length)));
      changed = true;
    }
    if (type === "IEND") return changed;
    i = end;
  }
  return changed;
}

/** EXIF and XMP chunks become zeroed `JUNK` chunks, and VP8X stops announcing them. */
function scrubWebp(b: Uint8Array): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let changed = false;
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, i + 4);
    const size = view.getUint32(i + 4, true);
    if (i + 8 + size > b.length) return changed;
    if (fourcc === "VP8X" && size >= 1 && ((b[i + 8] ?? 0) & 0x0c) !== 0) {
      b[i + 8] = (b[i + 8] ?? 0) & ~0x0c;
      changed = true;
    }
    if (fourcc === "EXIF" || fourcc === "XMP ") {
      b.set([0x4a, 0x55, 0x4e, 0x4b], i);
      b.fill(0, i + 8, i + 8 + size);
      changed = true;
    }
    i += 8 + size + (size % 2);
  }
  return changed;
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
