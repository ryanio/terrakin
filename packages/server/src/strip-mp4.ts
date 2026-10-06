/**
 * Remove location and free-form metadata from an ISO base media file (MP4). QuickTime MOV shares
 * the box layout and this handles it, though `sniffMediaType` refuses MOV uploads today. Decision
 * 0043 says what goes and why.
 *
 * Every change is made in place and keeps the file's length: a removed box becomes a `free` box of
 * the same size with a zeroed payload. Nothing moves, so the chunk offsets in `stco` and `co64`
 * still point at the right bytes and no parent box changes size.
 *
 * The input is changed in place and returned. A file that can't be walked safely comes back
 * undefined, and the upload is refused: a file we can't read is a file we can't vouch for. Bytes
 * after the last whole top-level box (some phones append vendor trailers) are cut off.
 *
 * The work is linear in the file's size and the memory is bounded: at most MAX_MP4_BOXES boxes are
 * read, and timed metadata sample ranges are checked and zeroed as they're read, never stored.
 */
export function stripMp4(b: Uint8Array): Uint8Array | undefined {
  try {
    return strip(b);
  } catch {
    return undefined;
  }
}

interface Box {
  type: string;
  start: number;
  /** Where the payload starts. */
  body: number;
  end: number;
}

/** Top-level boxes a player needs. Anything else (XMP `uuid`, `meta`, vendor trailers) is freed. */
const TOP_KEEP = new Set([
  "ftyp",
  "styp",
  "moov",
  "mdat",
  "free",
  "skip",
  "wide",
  "moof",
  "mfra",
  "sidx",
  "ssix",
  "prft",
  "emsg",
  "pdin",
]);

/** Children of `moov` a player needs. `udta`, `meta`, and vendor boxes are freed. */
const MOOV_KEEP = new Set(["mvhd", "trak", "mvex", "iods", "pssh", "meco"]);

/** Children of `trak` a player needs, including QuickTime's aperture and clipping boxes. */
const TRAK_KEEP = new Set([
  "tkhd",
  "tref",
  "trgr",
  "edts",
  "mdia",
  "meco",
  "tapt",
  "load",
  "clip",
  "matt",
  "kmat",
  "imap",
  "txas",
]);

/**
 * Freed wherever they turn up in the boxes we walk: user data (Apple's `©xyz` location, titles,
 * camera details), metadata boxes (QuickTime `keys` and `ilst`, with
 * `com.apple.quicktime.location.ISO6709`), 3GPP `loci`, and XMP.
 */
const DROP = new Set(["udta", "meta", "\xa9xyz", "loci", "XMP_"]);

/**
 * Padding. Its payload is zeroed wherever we find it, because QuickTime saves in place by turning
 * the old `moov`, location and all, into a `free` box.
 */
const PADDING = new Set(["free", "skip", "wide"]);

/** Containers we walk into below `moov` and `trak`. */
const WALK = new Set(["mdia", "minf", "stbl", "edts", "dinf", "mvex", "moof", "traf"]);

/** Fragment boxes, where `uuid` boxes carry sample data (PIFF) rather than metadata. */
const FRAGMENT = new Set(["moof", "traf"]);

/** Boxes whose creation and modification times are zeroed. */
const TIMES = new Set(["mvhd", "tkhd", "mdhd"]);

/** Handlers and sample entries of timed metadata tracks: GoPro GPS, Google's camera motion, Apple's `mebx`. */
const METADATA_HANDLERS = new Set(["meta", "camm"]);
const METADATA_ENTRIES = new Set(["gpmd", "camm", "mebx"]);

const fourcc = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);

/** Read the box at `at`, which must end by `limit`. Undefined if its header doesn't make sense. */
function readBox(view: DataView, b: Uint8Array, at: number, limit: number): Box | undefined {
  if (at + 8 > limit) return undefined;
  let size = view.getUint32(at);
  let body = at + 8;
  if (size === 1) {
    if (at + 16 > limit) return undefined;
    const high = view.getUint32(at + 8);
    // Past 2^53 a Number can't hold it, and no upload is anywhere near that big.
    if (high >= 0x200000) return undefined;
    size = high * 0x100000000 + view.getUint32(at + 12);
    body = at + 16;
  } else if (size === 0) {
    size = limit - at;
  }
  if (size < body - at || at + size > limit) return undefined;
  return { type: fourcc(b, at + 4), start: at, body, end: at + size };
}

/**
 * The most boxes one file may make us look at. A real moov tree is a few hundred boxes and a
 * 25 MB fragmented file a few thousand; a hostile file of millions of 8-byte boxes stops here
 * instead of filling the isolate's memory.
 */
export const MAX_MP4_BOXES = 50_000;

/** The children of a container, or undefined if they don't tile it exactly or the budget runs out. */
function children(view: DataView, b: Uint8Array, parent: Box, edits: Edits): Box[] | undefined {
  const out: Box[] = [];
  let at = parent.body;
  while (at < parent.end) {
    const box = readBox(view, b, at, parent.end);
    if (!box) {
      // QuickTime allows a 32-bit zero terminator at the end of a container.
      if (parent.end - at < 8 && b.subarray(at, parent.end).every((x) => x === 0)) break;
      return undefined;
    }
    if (--edits.budget < 0) return undefined;
    out.push(box);
    at = box.end;
  }
  return out;
}

/** Turn a box into `free` of the same size with a zeroed payload. */
function wipe(view: DataView, b: Uint8Array, box: Box) {
  b.fill(0, box.start, box.end);
  view.setUint32(box.start, box.end - box.start);
  b.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
}

/** Zero the creation and modification times of `mvhd`, `tkhd`, or `mdhd`. */
function zeroTimes(b: Uint8Array, box: Box) {
  const version = b[box.body] ?? 0;
  const start = box.body + 4;
  const end = start + (version === 1 ? 16 : 8);
  if (end <= box.end) b.fill(0, start, end);
}

interface Edits {
  wipe: Box[];
  times: Box[];
  /** Sample tables of timed metadata tracks, whose samples are zeroed once they check out. */
  sampleTables: Box[];
  metadataTracks: number;
  /** Boxes left to read before the file is refused. */
  budget: number;
}

function strip(b: Uint8Array): Uint8Array | undefined {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const edits: Edits = {
    wipe: [],
    times: [],
    sampleTables: [],
    metadataTracks: 0,
    budget: MAX_MP4_BOXES,
  };
  const mdats: Box[] = [];
  let moov = false;
  let fragmented = false;
  let end = b.length;
  let at = 0;
  while (at < b.length) {
    let box = readBox(view, b, at, b.length);
    if (!box && at + 8 <= b.length && fourcc(b, at + 4) === "mdat") {
      // A cut-off file: the media data runs to the end. Keep what's there.
      const large = view.getUint32(at) === 1;
      if (!large || at + 16 <= b.length) {
        box = { type: "mdat", start: at, body: at + (large ? 16 : 8), end: b.length };
      }
    }
    if (!box) {
      if (!moov) return undefined;
      end = at;
      break;
    }
    if (--edits.budget < 0) return undefined;
    if (box.type === "moov") {
      if (moov) return undefined;
      moov = true;
      if (!walk(view, b, box, "moov", edits)) return undefined;
    } else if (box.type === "mdat") {
      mdats.push(box);
    } else if (box.type === "moof") {
      fragmented = true;
      if (!walk(view, b, box, "moof", edits)) return undefined;
    } else if (!TOP_KEEP.has(box.type) || PADDING.has(box.type)) {
      edits.wipe.push(box);
    }
    at = box.end;
  }
  if (!moov) return undefined;
  // Samples of a metadata track in a fragmented file live in `moof` runs we don't trace. Refuse
  // rather than keep them.
  if (fragmented && edits.metadataTracks > 0) return undefined;
  // Every sample range must sit inside one `mdat`, and together they can't cover more bytes than
  // the file has, so zeroing them is linear in the file's size.
  let total = 0;
  for (const stbl of edits.sampleTables) {
    const ok = eachSampleRange(view, stbl, (from, to) => {
      total += to - from;
      const mdat = mdatAt(mdats, from);
      return total <= b.length && !!mdat && to <= Math.min(mdat.end, end);
    });
    if (!ok) return undefined;
  }
  // Every check passed. Now change the bytes.
  for (const box of edits.times) zeroTimes(b, box);
  for (const stbl of edits.sampleTables) {
    eachSampleRange(view, stbl, (from, to) => {
      b.fill(0, from, to);
      return true;
    });
  }
  for (const box of edits.wipe) wipe(view, b, box);
  return end === b.length ? b : b.subarray(0, end);
}

/** The `mdat` whose payload holds `offset`, by binary search (top-level boxes are in file order). */
function mdatAt(mdats: Box[], offset: number): Box | undefined {
  let lo = 0;
  let hi = mdats.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = mdats[mid] as Box;
    if (offset < m.body) hi = mid - 1;
    else if (offset >= m.end) lo = mid + 1;
    else return m;
  }
  return undefined;
}

/** Walk a container, noting what to wipe. False if the structure is broken. */
function walk(view: DataView, b: Uint8Array, parent: Box, kind: string, edits: Edits): boolean {
  const kids = children(view, b, parent, edits);
  if (!kids) return false;
  const keep = kind === "moov" ? MOOV_KEEP : kind === "trak" ? TRAK_KEEP : undefined;
  for (const box of kids) {
    if (TIMES.has(box.type)) edits.times.push(box);
    if (
      DROP.has(box.type) ||
      PADDING.has(box.type) ||
      (keep && !keep.has(box.type)) ||
      (box.type === "uuid" && !FRAGMENT.has(kind))
    ) {
      edits.wipe.push(box);
    } else if (box.type === "trak") {
      if (!walkTrack(view, b, box, edits)) return false;
    } else if (WALK.has(box.type)) {
      if (!walk(view, b, box, box.type, edits)) return false;
    }
  }
  return true;
}

/** Walk a track. A timed metadata track is freed whole, and its samples zeroed. */
function walkTrack(view: DataView, b: Uint8Array, trak: Box, edits: Edits): boolean {
  const before = { wipe: edits.wipe.length, times: edits.times.length };
  if (!walk(view, b, trak, "trak", edits)) return false;
  const find = (parent: Box | undefined, type: string) =>
    parent ? children(view, b, parent, edits)?.find((box) => box.type === type) : undefined;
  const mdia = find(trak, "mdia");
  const hdlr = find(mdia, "hdlr");
  const stbl = find(find(mdia, "minf"), "stbl");
  const stsd = find(stbl, "stsd");
  if (edits.budget < 0) return false;
  const handler = hdlr && hdlr.body + 12 <= hdlr.end ? fourcc(b, hdlr.body + 8) : "";
  const entry = stsd && stsd.body + 16 <= stsd.end ? fourcc(b, stsd.body + 12) : "";
  if (!METADATA_HANDLERS.has(handler) && !METADATA_ENTRIES.has(entry)) return true;
  edits.metadataTracks++;
  // The whole track goes, so the edits noted inside it are moot.
  edits.wipe.length = before.wipe;
  edits.times.length = before.times;
  edits.wipe.push(trak);
  if (stbl) edits.sampleTables.push(stbl);
  return true;
}

/**
 * Call `visit` with each chunk's byte range, from a track's sample table, without storing them.
 * Every count is checked against the size of the box that holds it before anything loops over it,
 * so the work is linear in the table's size. False if the table is broken or `visit` says stop.
 */
function eachSampleRange(
  view: DataView,
  stbl: Box,
  visit: (from: number, to: number) => boolean,
): boolean {
  const kids: Box[] = [];
  for (let at = stbl.body; at + 8 <= stbl.end; ) {
    const size = view.getUint32(at);
    if (size < 8 || at + size > stbl.end) break;
    const type = String.fromCharCode(
      view.getUint8(at + 4),
      view.getUint8(at + 5),
      view.getUint8(at + 6),
      view.getUint8(at + 7),
    );
    kids.push({ type, start: at, body: at + 8, end: at + size });
    at += size;
  }
  const get = (type: string) => kids.find((box) => box.type === type);
  const stsz = get("stsz");
  const stsc = get("stsc");
  const stco = get("stco");
  const co64 = get("co64");
  if (!stsz && !stsc && !stco && !co64) return true;
  if (!stsz || !stsc || !(stco || co64)) return false;

  // Chunk offsets.
  const table = (stco ?? co64) as Box;
  const wide = !stco;
  if (table.body + 8 > table.end) return false;
  const chunks = view.getUint32(table.body + 4);
  if (chunks > (table.end - table.body - 8) / (wide ? 8 : 4)) return false;
  const offset = (chunk: number) => {
    const at = table.body + 8 + chunk * (wide ? 8 : 4);
    return wide ? view.getUint32(at) * 0x100000000 + view.getUint32(at + 4) : view.getUint32(at);
  };

  // Sample sizes: one size for all, or a table.
  if (stsz.body + 12 > stsz.end) return false;
  const fixed = view.getUint32(stsz.body + 4);
  const samples = view.getUint32(stsz.body + 8);
  if (fixed === 0 && samples > (stsz.end - stsz.body - 12) / 4) return false;

  // Samples per chunk, as runs of chunks.
  if (stsc.body + 8 > stsc.end) return false;
  const runs = view.getUint32(stsc.body + 4);
  if (runs > (stsc.end - stsc.body - 8) / 12) return false;
  const first = (i: number) => view.getUint32(stsc.body + 8 + i * 12);
  const perChunk = (i: number) => view.getUint32(stsc.body + 12 + i * 12);

  let sample = 0;
  let r = 0;
  for (let chunk = 1; chunk <= chunks && sample < samples; chunk++) {
    while (r + 1 < runs && first(r + 1) <= chunk) r++;
    if (runs === 0 || first(r) > chunk) return false;
    const count = Math.min(perChunk(r), samples - sample);
    let bytes = 0;
    if (fixed !== 0) {
      bytes = count * fixed;
    } else {
      for (let k = 0; k < count; k++) bytes += view.getUint32(stsz.body + 12 + (sample + k) * 4);
    }
    sample += count;
    const from = offset(chunk - 1);
    if (!visit(from, from + bytes)) return false;
  }
  return true;
}
