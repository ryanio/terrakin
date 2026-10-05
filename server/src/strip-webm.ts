/**
 * Remove free-form metadata from a WebM (Matroska) file: tags, attachments, chapters, the segment
 * title and recording date, and track names. Decision 0043 says what goes and why.
 *
 * Like MP4, every change is made in place and keeps the file's length: a removed element becomes
 * a Void element of the same size with a zeroed payload, so nothing moves and every position the
 * file records (cues, seek entries) still points at the same bytes. Seek entries that pointed at a
 * removed element are voided too.
 *
 * The input is changed in place and returned. A file that can't be walked safely comes back
 * undefined, and the upload is refused. Bytes after the last whole top-level element are cut off.
 */
export function stripWebm(b: Uint8Array): Uint8Array | undefined {
  try {
    return strip(b);
  } catch {
    return undefined;
  }
}

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const VOID = 0xec;
const CRC32 = 0xbf;
const SEEK_HEAD = 0x114d9b74;
const SEEK = 0x4dbb;
const SEEK_ID = 0x53ab;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const CLUSTER = 0x1f43b675;
const CUES = 0x1c53bb6b;
const TAGS = 0x1254c367;
const ATTACHMENTS = 0x1941a469;
const CHAPTERS = 0x1043a770;
const TITLE = 0x7ba9;
const DATE_UTC = 0x4461;
const NAME = 0x536e;

/** Segment children a player needs. Tags, attachments, chapters, and anything unknown are voided. */
const SEGMENT_KEEP = new Set([SEEK_HEAD, INFO, TRACKS, CLUSTER, CUES, VOID]);

/** Every level-1 id. One of these (or a new segment) ends a cluster of unknown size. */
const LEVEL_1 = new Set([SEEK_HEAD, INFO, TRACKS, CLUSTER, CUES, TAGS, ATTACHMENTS, CHAPTERS]);

interface Element {
  id: number;
  start: number;
  body: number;
  /** Undefined for an element of unknown size, which runs until its parent's end. */
  end: number | undefined;
}

/** A variable-length integer. Ids keep their marker bit; sizes drop it. */
function vint(b: Uint8Array, at: number, limit: number, keepMarker: boolean, maxLength: number) {
  const first = b[at];
  if (first === undefined || first === 0 || at >= limit) return undefined;
  const length = Math.clz32(first) - 23;
  if (length > maxLength || at + length > limit) return undefined;
  const mask = 0xff >> length;
  let value = keepMarker ? first : first & mask;
  let allOnes = (first & mask) === mask;
  for (let i = 1; i < length; i++) {
    const byte = b[at + i] ?? 0;
    value = value * 256 + byte;
    allOnes &&= byte === 0xff;
  }
  return { value, length, allOnes };
}

function readElement(b: Uint8Array, at: number, limit: number): Element | undefined {
  const id = vint(b, at, limit, true, 4);
  if (!id) return undefined;
  const size = vint(b, at + id.length, limit, false, 8);
  if (!size) return undefined;
  const body = at + id.length + size.length;
  if (size.allOnes) return { id: id.value, start: at, body, end: undefined };
  if (body + size.value > limit) return undefined;
  return { id: id.value, start: at, body, end: body + size.value };
}

/** Overwrite an element with a Void element of the same total size. */
function voidOut(b: Uint8Array, from: number, to: number) {
  const total = to - from;
  b.fill(0, from, to);
  b[from] = VOID;
  if (total >= 9) {
    // An 8-byte size: the marker byte, then 7 bytes of length.
    b[from + 1] = 0x01;
    let rest = total - 9;
    for (let i = 8; i >= 2; i--) {
      b[from + i] = rest & 0xff;
      rest = Math.floor(rest / 256);
    }
  } else {
    b[from + 1] = 0x80 | (total - 2);
  }
}

interface Edits {
  voids: [number, number][];
}

function strip(b: Uint8Array): Uint8Array | undefined {
  const edits: Edits = { voids: [] };
  let segments = 0;
  let at = 0;
  let end = b.length;
  while (at < b.length) {
    const el = readElement(b, at, b.length);
    if (!el) {
      if (segments === 0) return undefined;
      end = at;
      break;
    }
    const elEnd = el.end ?? b.length;
    if (el.id === SEGMENT) {
      segments++;
      if (!walkSegment(b, el.body, elEnd, edits)) return undefined;
    } else if (el.id !== EBML && el.id !== VOID) {
      if (el.end === undefined) return undefined;
      edits.voids.push([el.start, elEnd]);
    }
    at = elEnd;
  }
  if (segments === 0) return undefined;
  for (const [from, to] of edits.voids) voidOut(b, from, to);
  return end === b.length ? b : b.subarray(0, end);
}

function walkSegment(b: Uint8Array, from: number, to: number, edits: Edits): boolean {
  const seekHeads: Element[] = [];
  let at = from;
  while (at < to) {
    const el = readElement(b, at, to);
    if (!el) return false;
    if (el.end === undefined) {
      // Only clusters may have an unknown size (browsers' MediaRecorder writes them that way).
      if (el.id !== CLUSTER) return false;
      at = clusterEnd(b, el.body, to);
      if (at < 0) return false;
      continue;
    }
    if (!SEGMENT_KEEP.has(el.id)) {
      edits.voids.push([el.start, el.end]);
    } else if (el.id === SEEK_HEAD) {
      seekHeads.push(el);
    } else if (el.id === INFO) {
      if (!voidChildren(b, el, new Set([TITLE, DATE_UTC, CRC32]), edits)) return false;
    } else if (el.id === TRACKS) {
      if (!walkTracks(b, el, edits)) return false;
    }
    at = el.end;
  }
  for (const head of seekHeads) {
    if (!walkSeekHead(b, head, edits)) return false;
  }
  return true;
}

/** Where a cluster of unknown size ends: at the next level-1 element, or the segment's end. */
function clusterEnd(b: Uint8Array, from: number, to: number): number {
  let at = from;
  while (at < to) {
    const id = vint(b, at, to, true, 4);
    if (id && (LEVEL_1.has(id.value) || id.value === SEGMENT || id.value === EBML)) return at;
    const el = readElement(b, at, to);
    if (!el || el.end === undefined) return -1;
    at = el.end;
  }
  return to;
}

/** Void the direct children of `parent` whose ids are in `drop`. */
function voidChildren(b: Uint8Array, parent: Element, drop: Set<number>, edits: Edits): boolean {
  const end = parent.end ?? parent.body;
  let at = parent.body;
  while (at < end) {
    const el = readElement(b, at, end);
    if (!el || el.end === undefined) return false;
    if (drop.has(el.id)) edits.voids.push([el.start, el.end]);
    at = el.end;
  }
  return true;
}

function walkTracks(b: Uint8Array, tracks: Element, edits: Edits): boolean {
  const end = tracks.end ?? tracks.body;
  let at = tracks.body;
  while (at < end) {
    const el = readElement(b, at, end);
    if (!el || el.end === undefined) return false;
    if (el.id === TRACK_ENTRY && !voidChildren(b, el, new Set([NAME, CRC32]), edits)) return false;
    if (el.id === CRC32) edits.voids.push([el.start, el.end]);
    at = el.end;
  }
  return true;
}

/** Void the seek entries that point at an element we removed. */
function walkSeekHead(b: Uint8Array, head: Element, edits: Edits): boolean {
  const end = head.end ?? head.body;
  let at = head.body;
  while (at < end) {
    const seek = readElement(b, at, end);
    if (!seek || seek.end === undefined) return false;
    if (seek.id === CRC32) edits.voids.push([seek.start, seek.end]);
    if (seek.id === SEEK) {
      let inner = seek.body;
      while (inner < seek.end) {
        const el = readElement(b, inner, seek.end);
        if (!el || el.end === undefined) return false;
        if (el.id === SEEK_ID) {
          const target = vint(b, el.body, el.end, true, 4);
          if (!target || !SEGMENT_KEEP.has(target.value)) edits.voids.push([seek.start, seek.end]);
        }
        inner = el.end;
      }
    }
    at = seek.end;
  }
  return true;
}
