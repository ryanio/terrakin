/**
 * For tests: tiny hand-built videos and models that carry the metadata `strip-metadata.ts`
 * removes, so tests need no binary fixtures. Each one also says where its real content is, so a
 * test can check that survived.
 */

/** Bytes from text, one byte per character, so `\xa9` stays one byte. */
export const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

/** The bytes as text, one character per byte, for `includes` checks. */
export const asText = (b: Uint8Array) => {
  let out = "";
  for (let i = 0; i < b.length; i += 0x8000)
    out += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return out;
};

export type Part = Uint8Array | number[] | string;

export function cat(...parts: Part[]): Uint8Array {
  const arrays = parts.map((p) =>
    typeof p === "string" ? latin1(p) : p instanceof Uint8Array ? p : Uint8Array.from(p),
  );
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

export const u32 = (n: number) => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
export const u32le = (n: number) => [
  n & 0xff,
  (n >>> 8) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 24) & 0xff,
];

// ---------- MP4 ----------

export const box = (type: string, ...body: Part[]) => {
  const payload = cat(...body);
  return cat(u32(8 + payload.length), type, payload);
};

/** Version and flags of a full box. */
const FULL = [0, 0, 0, 0];

/** A full box header's version 0 times: creation then modification. */
const times = [...u32(0x11223344), ...u32(0x55667788)];

const hdlr = (handler: string) =>
  box("hdlr", FULL, u32(0), handler, Array(12).fill(0), "Handler\0");

const track = (
  handler: string,
  entry: string,
  sizes: number[],
  offsets: number[],
  extra: Part = [],
) =>
  box(
    "trak",
    box("tkhd", FULL, times, Array(72).fill(0)),
    box(
      "mdia",
      box("mdhd", FULL, times, Array(12).fill(0)),
      hdlr(handler),
      box(
        "minf",
        box(
          "stbl",
          box("stsd", FULL, u32(1), box(entry, Array(16).fill(0))),
          box("stsz", FULL, u32(0), u32(sizes.length), ...sizes.map(u32)),
          // One sample per chunk.
          box("stsc", FULL, u32(1), u32(1), u32(1), u32(1)),
          box("stco", FULL, u32(offsets.length), ...offsets.map(u32)),
        ),
      ),
    ),
    extra,
  );

export const MP4_GPS = "+37.7749-122.4194/";
export const MP4_VIDEO = "VIDEOFRAME01VIDEOFRAME02";

/**
 * An MP4 shaped like a phone's: Apple's `©xyz` in `moov/udta`, a QuickTime `keys` location in
 * `moov/meta`, a title in a track's `udta`, a GoPro-style GPS track whose samples sit in `mdat`,
 * and an XMP `uuid` box. The video samples are MP4_VIDEO.
 */
export function mp4WithGps(options: { trailer?: Part } = {}) {
  const video = [MP4_VIDEO.slice(0, 12), MP4_VIDEO.slice(12)];
  const gps = ["GPS5+37.7749", "GPS5-122.419"];
  const build = (videoAt: number[], gpsAt: number[]) => {
    const ftyp = box("ftyp", "isom", u32(0), "isomavc1");
    const moov = box(
      "moov",
      box("mvhd", FULL, times, Array(88).fill(0)),
      track(
        "vide",
        "avc1",
        video.map((s) => s.length),
        videoAt,
        box("udta", box("\xa9nam", "Walk home with Ryan")),
      ),
      track(
        "meta",
        "gpmd",
        gps.map((s) => s.length),
        gpsAt,
      ),
      box("udta", box("\xa9xyz", [0, MP4_GPS.length, 0x15, 0xc7], MP4_GPS)),
      box(
        "meta",
        FULL,
        hdlr("mdta"),
        box("keys", FULL, u32(1), box("mdta", "com.apple.quicktime.location.ISO6709")),
        box("ilst", box("\0\0\0\x01", box("data", u32(1), u32(0), MP4_GPS))),
      ),
    );
    const uuid = box(
      "uuid",
      [
        0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf,
        0xac,
      ],
      "<x:xmpmeta>exif:GPSLatitude 37.7749</x:xmpmeta>",
    );
    const head = cat(ftyp, moov, uuid);
    const mdatBody = cat(video[0] ?? "", gps[0] ?? "", video[1] ?? "", gps[1] ?? "");
    return { head, mdat: box("mdat", mdatBody) };
  };
  const first = build([0, 0], [0, 0]);
  const data = first.head.length + 8;
  const s = (i: number) => (video[i]?.length ?? 0) + (gps[i]?.length ?? 0);
  const { head, mdat } = build(
    [data, data + s(0)],
    [data + (video[0]?.length ?? 0), data + s(0) + (video[1]?.length ?? 0)],
  );
  return cat(head, mdat, options.trailer ?? []);
}

/** Walk boxes from `start` to `end`. Throws if they don't tile exactly. */
export function mp4Boxes(b: Uint8Array, start = 0, end = b.length) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: { type: string; start: number; end: number }[] = [];
  let at = start;
  while (at < end) {
    const size = view.getUint32(at);
    if (size < 8 || at + size > end) throw new Error(`bad box at ${at}`);
    out.push({ type: asText(b.subarray(at + 4, at + 8)), start: at, end: at + size });
    at += size;
  }
  return out;
}

// ---------- WebM ----------

/** An EBML element with a 1-byte size when it fits, else an 8-byte one. */
export const el = (id: number[], ...body: Part[]) => {
  const payload = cat(...body);
  const size =
    payload.length < 127 ? [0x80 | payload.length] : [0x01, 0, 0, ...u32(payload.length)];
  return cat(id, size, payload);
};

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

export const WEBM_FRAME = "FRAMEDATA";

/**
 * A WebM like a browser's MediaRecorder writes (unknown-size segment and cluster), plus a title, a
 * recording date, a track name, location tags, an attachment, and chapters.
 */
export function webmWithTags() {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], "webm"));
  const seek = (target: number[]) =>
    el([0x4d, 0xbb], el([0x53, 0xab], target), el([0x53, 0xac], [0, 0]));
  const body = cat(
    el(
      [0x11, 0x4d, 0x9b, 0x74],
      seek([0x15, 0x49, 0xa9, 0x66]),
      seek([0x12, 0x54, 0xc3, 0x67]),
      seek([0x19, 0x41, 0xa4, 0x69]),
    ),
    el(
      [0x15, 0x49, 0xa9, 0x66],
      el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]),
      el([0x4d, 0x80], "MuxerApp"),
      el([0x57, 0x41], "WriterApp"),
      el([0x7b, 0xa9], "Ryan at 12 Oak St"),
      el([0x73, 0x84], "party at Oak St.webm"),
      el([0x44, 0x61], [1, 2, 3, 4, 5, 6, 7, 8]),
    ),
    el(
      [0x16, 0x54, 0xae, 0x6b],
      el([0xae], el([0xd7], [1]), el([0x86], "V_VP8"), el([0x53, 0x6e], "Ry")),
    ),
    cat([0x1f, 0x43, 0xb6, 0x75], UNKNOWN, el([0xe7], [0]), el([0xa3], WEBM_FRAME)),
    el(
      [0x10, 0x43, 0xa7, 0x70],
      el([0x45, 0xb9], el([0xb6], el([0x80], el([0x85], "Kitchen at home")))),
    ),
    el(
      [0x12, 0x54, 0xc3, 0x67],
      el(
        [0x73, 0x73],
        el([0x67, 0xc8], el([0x45, 0xa3], "LOCATION"), el([0x44, 0x87], "+37.7749-122.4194")),
      ),
    ),
    el(
      [0x19, 0x41, 0xa4, 0x69],
      el([0x61, 0xa7], el([0x46, 0x6e], "home.jpg"), el([0x46, 0x5c], "EXIF GPS 37.7749")),
    ),
  );
  return cat(header, [0x18, 0x53, 0x80, 0x67], UNKNOWN, body);
}

// ---------- GLB ----------

/** A JPEG that is only an EXIF segment with a location and a comment. */
export const jpegWithExif = () =>
  cat(
    [0xff, 0xd8, 0xff, 0xe1],
    [0, 2 + 6 + 18],
    "Exif\0\0",
    "GPS +37.7749 -122.",
    [0xff, 0xfe, 0, 2 + 11],
    "Ryan's desk",
    [0xff, 0xda, 0, 2, 0x11, 0x22, 0xff, 0xd9],
  );

/** A GLB from a JSON document and a binary chunk, padded the way the spec asks. */
export const glb = (json: unknown, bin?: Uint8Array) => glbText(JSON.stringify(json), bin);

/** A GLB from JSON text as written, for JSON that `JSON.stringify` wouldn't produce. */
export function glbText(json: string, bin?: Uint8Array) {
  const text = new TextEncoder().encode(json);
  const jsonPad = cat(text, Array((4 - (text.length % 4)) % 4).fill(0x20));
  const binPad = bin ? cat(bin, Array((4 - (bin.length % 4)) % 4).fill(0)) : undefined;
  const chunks = cat(
    u32le(jsonPad.length),
    "JSON",
    jsonPad,
    binPad ? cat(u32le(binPad.length), "BIN\0", binPad) : [],
  );
  return cat("glTF", u32le(2), u32le(12 + chunks.length), chunks);
}

/** The smallest valid GLB: an empty scene. */
export const tinyGlb = () => glb({ asset: { version: "2.0" } });

/** Read a GLB back: its JSON and its binary chunk. */
export function readGlb(b: Uint8Array) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLength)));
  const binAt = 20 + jsonLength;
  const bin =
    binAt + 8 <= b.length
      ? b.subarray(binAt + 8, binAt + 8 + view.getUint32(binAt, true))
      : undefined;
  return { length: view.getUint32(8, true), jsonLength, json, bin };
}
