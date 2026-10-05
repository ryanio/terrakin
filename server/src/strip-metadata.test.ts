import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  asText,
  box,
  cat,
  el,
  glb,
  glbText,
  jpegWithExif,
  MP4_GPS,
  MP4_VIDEO,
  mp4Boxes,
  mp4WithGps,
  type Part,
  readGlb,
  tinyGlb,
  u32,
  WEBM_FRAME,
  webmWithTags,
} from "./media-fixtures";
import { MAX_GLB_JSON_BYTES, scrubImage } from "./strip-glb";
import { stripMetadata } from "./strip-metadata";
import { MAX_MP4_BOXES } from "./strip-mp4";
import { MAX_WEBM_ELEMENTS } from "./strip-webm";

/** A small seeded generator, so a failing mutation can be replayed. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Feed every truncation and a few thousand random corruptions of `file` to the stripper. None may
 * throw, every answer is either a refusal or bytes, and some corruptions are still read (a
 * stripper that refused everything would pass otherwise).
 */
function fuzz(
  file: Uint8Array,
  strip: (b: Uint8Array) => Uint8Array | undefined,
  check?: (out: Uint8Array) => void,
) {
  for (let n = 0; n < file.length; n++) {
    const out = strip(file.slice(0, n));
    if (out) check?.(out);
  }
  const next = random(27);
  let kept = 0;
  for (let round = 0; round < 3000; round++) {
    const copy = file.slice();
    const flips = 1 + Math.floor(next() * 4);
    for (let k = 0; k < flips; k++) {
      const at = Math.floor(next() * copy.length);
      // Mostly hit lengths with extremes, sometimes any byte.
      copy[at] =
        next() < 0.5 ? ([0, 0xff, 1, 0x7f][Math.floor(next() * 4)] ?? 0) : Math.floor(next() * 256);
    }
    const out = strip(copy);
    expect(out === undefined || out instanceof Uint8Array).toBe(true);
    if (out) kept++;
  }
  expect(kept).toBeGreaterThan(100);
  expect(kept).toBeLessThan(3000);
}

describe("MP4 metadata", () => {
  it("frees location, user data, metadata tracks, and XMP in place", () => {
    const input = mp4WithGps();
    const length = input.length;
    const out = stripMetadata(input.slice(), "video/mp4");
    expect(out).toBeDefined();
    if (!out) return;
    expect(out.length).toBe(length);
    const text = asText(out);
    for (const secret of [MP4_GPS, "37.7749", "122.419", "Ryan", "ISO6709", "xmpmeta", "GPS5"]) {
      expect(text, secret).not.toContain(secret);
    }
    // The video samples are untouched, and the box tree still parses.
    expect(text).toContain(MP4_VIDEO.slice(0, 12));
    expect(text).toContain(MP4_VIDEO.slice(12));
    expect(mp4Boxes(out).map((b) => b.type)).toEqual(["ftyp", "moov", "free", "mdat"]);
    const moov = mp4Boxes(out).find((b) => b.type === "moov");
    if (!moov) throw new Error("no moov");
    const kids = mp4Boxes(out, moov.start + 8, moov.end);
    expect(kids.map((b) => b.type)).toEqual(["mvhd", "trak", "free", "free", "free"]);
    const trak = kids[1];
    if (!trak) throw new Error("no trak");
    expect(mp4Boxes(out, trak.start + 8, trak.end).map((b) => b.type)).toEqual([
      "tkhd",
      "mdia",
      "free",
    ]);
    // Freed boxes are all zeros after their header.
    for (const freed of kids.filter((b) => b.type === "free")) {
      expect(out.subarray(freed.start + 8, freed.end).every((x) => x === 0)).toBe(true);
    }
    // Creation and modification times are zeroed.
    expect(Array.from(out.subarray(moov.start + 8 + 12, moov.start + 8 + 20))).toEqual(
      Array(8).fill(0),
    );
    // The video track's chunk offset still points at its first frame.
    const stco = text.indexOf("stco");
    const offset = new DataView(out.buffer, out.byteOffset).getUint32(stco + 12);
    expect(text.slice(offset, offset + 12)).toBe(MP4_VIDEO.slice(0, 12));
  });

  it("leaves a clean file as it was", () => {
    const clean = cat(
      box("ftyp", "isom", u32(0), "isom"),
      box("moov", box("mvhd", [1, 0, 0, 0], Array(16).fill(0), Array(88).fill(0))),
      box("mdat", "frames"),
    );
    expect(stripMetadata(clean.slice(), "video/mp4")).toEqual(clean);
  });

  it("cuts off a vendor trailer that isn't boxes", () => {
    const file = mp4WithGps({ trailer: "SEFH\x01\x02home 37.7749 SEFT" });
    const out = stripMetadata(file, "video/mp4");
    expect(out).toBeDefined();
    expect(asText(out ?? new Uint8Array())).not.toContain("37.7749");
    expect(out?.length).toBe(mp4WithGps().length);
  });

  it("refuses files it can't walk", () => {
    const refused = [
      ["no moov", cat(box("ftyp", "isom", u32(0)), box("mdat", "x"))],
      ["a box longer than the file", cat(box("ftyp", "isom", u32(0)), u32(1000), "moov")],
      [
        "a 64-bit size past 2^53",
        cat(box("ftyp", "isom", u32(0)), u32(1), "moov", [0xff, 0xff, 0xff, 0xff], u32(0)),
      ],
      [
        "a child that overruns its parent",
        cat(box("ftyp", "isom", u32(0)), box("moov", u32(64), "trak", "short")),
      ],
      ["two moov boxes", cat(box("ftyp", "isom", u32(0)), box("moov"), box("moov"))],
      [
        "a metadata track whose samples point outside mdat",
        cat(
          box("ftyp", "isom", u32(0)),
          box(
            "moov",
            box(
              "trak",
              box(
                "mdia",
                box("hdlr", [0, 0, 0, 0], u32(0), "meta"),
                box(
                  "minf",
                  box(
                    "stbl",
                    box("stsz", [0, 0, 0, 0], u32(0), u32(1), u32(4)),
                    box("stsc", [0, 0, 0, 0], u32(1), u32(1), u32(1), u32(1)),
                    box("stco", [0, 0, 0, 0], u32(1), u32(0)),
                  ),
                ),
              ),
            ),
          ),
          box("mdat", "data"),
        ),
      ],
      [
        "sample tables that claim billions of entries",
        cat(
          box("ftyp", "isom", u32(0)),
          box(
            "moov",
            box(
              "trak",
              box(
                "mdia",
                box("hdlr", [0, 0, 0, 0], u32(0), "meta"),
                box(
                  "minf",
                  box(
                    "stbl",
                    box("stsz", [0, 0, 0, 0], u32(0), u32(0xffffffff)),
                    box("stsc", [0, 0, 0, 0], u32(0xffffffff)),
                    box("stco", [0, 0, 0, 0], u32(0xffffffff)),
                  ),
                ),
              ),
            ),
          ),
          box("mdat", "data"),
        ),
      ],
    ] as const;
    for (const [why, file] of refused) {
      expect(stripMetadata(file.slice(), "video/mp4"), why).toBeUndefined();
    }
  });

  it("refuses a fragmented file with a metadata track", () => {
    const file = mp4WithGps({ trailer: box("moof", box("mfhd", [0, 0, 0, 0], u32(1))) });
    expect(stripMetadata(file, "video/mp4")).toBeUndefined();
  });

  it("zeroes padding, where QuickTime leaves an old moov behind", () => {
    const old = box("moov", box("udta", box("\xa9xyz", [0, 18, 0x15, 0xc7], MP4_GPS)));
    const file = cat(mp4WithGps(), box("free", old));
    const out = stripMetadata(file, "video/mp4");
    expect(out?.length).toBe(file.length);
    expect(asText(out ?? new Uint8Array())).not.toContain("37.7749");
  });

  // A hostile file must cost memory and time in proportion to its size, never more.
  it("refuses a file of more tiny boxes than any real video has", () => {
    const head = cat(box("ftyp", "isom", u32(0)), box("moov", box("mvhd", Array(100).fill(0))));
    const tiny = new Uint8Array((MAX_MP4_BOXES + 10) * 8);
    for (let i = 0; i < tiny.length; i += 8) tiny.set([0, 0, 0, 8, 0x6a, 0x75, 0x6e, 0x6b], i);
    expect(stripMetadata(cat(head, tiny), "video/mp4")).toBeUndefined();
  });

  const metadataTrack = (stsz: Part, stsc: Part, stco: Part) =>
    box(
      "trak",
      box(
        "mdia",
        box("hdlr", [0, 0, 0, 0], u32(0), "meta"),
        box(
          "minf",
          box(
            "stbl",
            box("stsz", [0, 0, 0, 0], stsz),
            box("stsc", [0, 0, 0, 0], stsc),
            box("stco", [0, 0, 0, 0], stco),
          ),
        ),
      ),
    );

  it("finds sample ranges among many mdat boxes in linear time", () => {
    const mdats = 40_000;
    const ftyp = box("ftyp", "isom", u32(0));
    const chunks = 20_000;
    const build = (lastMdat: number) =>
      box(
        "moov",
        metadataTrack(
          [...u32(1), ...u32(chunks)],
          [...u32(1), ...u32(1), ...u32(1), ...u32(1)],
          [...u32(chunks), ...Array.from({ length: chunks }, () => u32(lastMdat)).flat()],
        ),
      );
    const moovLength = build(0).length;
    const last = ftyp.length + moovLength + (mdats - 1) * 9 + 8;
    const tiny = new Uint8Array(mdats * 9);
    for (let i = 0; i < tiny.length; i += 9)
      tiny.set([0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0x47], i);
    const file = cat(ftyp, build(last), tiny);
    const started = performance.now();
    const out = stripMetadata(file, "video/mp4");
    expect(performance.now() - started).toBeLessThan(1500);
    expect(out).toBeDefined();
    expect(out?.[last]).toBe(0);
  });

  it("refuses sample ranges that add up to more than the file", () => {
    const ftyp = box("ftyp", "isom", u32(0));
    const chunks = 1000;
    const build = (at: number) =>
      box(
        "moov",
        metadataTrack(
          [...u32(1000), ...u32(chunks)],
          [...u32(1), ...u32(1), ...u32(1), ...u32(1)],
          [...u32(chunks), ...Array.from({ length: chunks }, () => u32(at)).flat()],
        ),
      );
    const at = ftyp.length + build(0).length + 8;
    expect(
      stripMetadata(cat(ftyp, build(at), box("mdat", new Uint8Array(1000))), "video/mp4"),
    ).toBeUndefined();
  });

  it("survives truncated and corrupted files without throwing", () => {
    const file = mp4WithGps();
    fuzz(
      file,
      (b) => stripMetadata(b, "video/mp4"),
      // A cut-off file that comes back still has no location in it.
      (out) => expect(asText(out)).not.toContain("37.7749"),
    );
  });
});

describe("WebM metadata", () => {
  it("voids tags, attachments, chapters, the title, date, and track names in place", () => {
    const input = webmWithTags();
    const out = stripMetadata(input.slice(), "video/webm");
    expect(out).toBeDefined();
    if (!out) return;
    expect(out.length).toBe(input.length);
    const text = asText(out);
    for (const secret of ["Oak St", "37.7749", "home.jpg", "Kitchen", "LOCATION", "Ry", "party"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain(WEBM_FRAME);
    expect(text).toContain("V_VP8");
    expect(text).toContain("MuxerApp");
    // Tags and Attachments ids appear nowhere, not even in the seek index.
    expect(text).not.toContain("\x12\x54\xc3\x67");
    expect(text).not.toContain("\x19\x41\xa4\x69");
    // The info seek entry survives.
    expect(text).toContain("\x53\xab\x84\x15\x49\xa9\x66");
  });

  it("writes Void elements a reader can step over", () => {
    const out = stripMetadata(webmWithTags(), "video/webm");
    if (!out) throw new Error("refused");
    // Walk the segment's children with a plain EBML reader: every one has a readable size.
    const segment = asText(out).indexOf("\x18\x53\x80\x67") + 12;
    const ids: number[] = [];
    let at = segment;
    while (at < out.length) {
      const idLength = Math.clz32(out[at] ?? 0) - 23;
      const id = out.subarray(at, at + idLength).reduce((n, x) => n * 256 + x, 0);
      ids.push(id);
      const first = out[at + idLength] ?? 0;
      const sizeLength = Math.clz32(first) - 23;
      let size = first & (0xff >> sizeLength);
      for (let i = 1; i < sizeLength; i++) size = size * 256 + (out[at + idLength + i] ?? 0);
      const unknown = sizeLength === 8 && size === 2 ** 56 - 1;
      if (unknown) {
        // The cluster: step over its known-size children to the next level-1 element.
        at += idLength + sizeLength;
        at += 3; // timecode
        at += 2 + WEBM_FRAME.length; // simple block
        continue;
      }
      at += idLength + sizeLength + size;
    }
    expect(at).toBe(out.length);
    expect(ids).toEqual([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0xec, 0xec, 0xec]);
  });

  it("refuses files it can't walk", () => {
    const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], "webm"));
    const refused = [
      ["no segment", header],
      [
        "an element longer than the segment",
        cat(header, el([0x18, 0x53, 0x80, 0x67], [0x1a, 0xff])),
      ],
      [
        "an id longer than 4 bytes",
        cat(header, el([0x18, 0x53, 0x80, 0x67], [0x08, 1, 2, 3, 4, 0x80])),
      ],
      [
        "an unknown-size element that isn't a cluster",
        cat(header, el([0x18, 0x53, 0x80, 0x67], [0x12, 0x54, 0xc3, 0x67, 0xff])),
      ],
    ] as const;
    for (const [why, file] of refused) {
      expect(stripMetadata(file.slice(), "video/webm"), why).toBeUndefined();
    }
  });

  it("refuses a segment of more tiny elements than any real video has", () => {
    const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], "webm"));
    const tiny = new Uint8Array((MAX_WEBM_ELEMENTS + 10) * 2);
    for (let i = 0; i < tiny.length; i += 2) tiny.set([0xa0, 0x80], i);
    const unknown = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    expect(
      stripMetadata(cat(header, [0x18, 0x53, 0x80, 0x67], unknown, tiny), "video/webm"),
    ).toBeUndefined();
  });

  it("survives truncated and corrupted files without throwing", () => {
    fuzz(webmWithTags(), (b) => stripMetadata(b, "video/webm"));
  });
});

const png = (...chunks: [string, Uint8Array | string][]) =>
  cat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...chunks.map(([type, data]) => {
      const body = cat(type, data);
      return cat(u32(body.length - 4), body, u32(crc32(body)));
    }),
  );

describe("GLB metadata", () => {
  const positions = new Uint8Array(36).fill(7);

  const model = (extra: Record<string, unknown> = {}) => {
    const jpeg = jpegWithExif();
    const texture = png(
      ["IHDR", new Uint8Array(13)],
      ["tEXt", "Comment\0Ryan at home"],
      ["IEND", ""],
    );
    return glb(
      {
        asset: {
          version: "2.0",
          generator: "Blender",
          copyright: "Ryan G, CC BY 4.0",
          extras: { location: "37.7749,-122.4194" },
        },
        extensionsUsed: ["KHR_xmp_json_ld", "KHR_materials_unlit"],
        extensions: { KHR_xmp_json_ld: { packets: [{ "dc:creator": "Ryan at home" }] } },
        scenes: [{ nodes: [0] }],
        nodes: [{ name: "cube", mesh: 0, extras: { note: "made at 12 Oak St" } }],
        meshes: [
          {
            primitives: [{ attributes: { POSITION: 0 }, extras: { a: "Oak St" } }],
            extensions: { KHR_xmp_json_ld: { packet: 0 } },
          },
        ],
        materials: [{ extensions: { KHR_materials_unlit: {} } }],
        buffers: [{ byteLength: 36 + jpeg.length }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
          { buffer: 0, byteOffset: 36, byteLength: jpeg.length },
        ],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
        images: [
          { bufferView: 1, mimeType: "image/jpeg" },
          { uri: `data:image/png;base64,${Buffer.from(texture).toString("base64")}` },
        ],
        ...extra,
      },
      cat(positions, jpeg),
    );
  };

  it("drops extras, XMP, and texture metadata, and keeps copyright and the mesh", () => {
    const input = model();
    const out = stripMetadata(input.slice(), "model/gltf-binary");
    expect(out).toBeDefined();
    if (!out) return;
    const text = asText(out);
    for (const secret of ["37.7749", "Oak St", "Ryan at home", "xmp", "Ryan's desk", "extras"]) {
      expect(text, secret).not.toContain(secret);
    }
    const { length, jsonLength, json, bin } = readGlb(out);
    expect(length).toBe(out.length);
    expect(jsonLength % 4).toBe(0);
    // The JSON shrank, so it was rewritten in place and nothing moved.
    expect(out.length).toBe(input.length);
    expect(json.asset).toEqual({
      version: "2.0",
      generator: "Blender",
      copyright: "Ryan G, CC BY 4.0",
    });
    expect(json.extensionsUsed).toEqual(["KHR_materials_unlit"]);
    expect(json).not.toHaveProperty("extensions");
    expect(json.meshes[0]).not.toHaveProperty("extensions");
    expect(json.materials[0].extensions).toEqual({ KHR_materials_unlit: {} });
    expect(Array.from(bin?.subarray(0, 36) ?? [])).toEqual(Array.from(positions));
    // The JPEG keeps its markers and length; its EXIF and comment bytes are zero.
    const jpeg = bin?.subarray(36, 36 + jpegWithExif().length) ?? new Uint8Array();
    expect(Array.from(jpeg.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect(Array.from(jpeg.slice(-8))).toEqual([0xff, 0xda, 0, 2, 0x11, 0x22, 0xff, 0xd9]);
    // The PNG's text chunk became a private chunk with a valid CRC.
    const texture = Buffer.from(json.images[1].uri.split(",")[1], "base64");
    const at = texture.indexOf("voId");
    expect(at).toBeGreaterThan(0);
    const length2 = texture.readUInt32BE(at - 4);
    expect(texture.readUInt32BE(at + 4 + length2)).toBe(
      crc32(texture.subarray(at, at + 4 + length2)),
    );
    expect(texture.includes("tEXt")).toBe(false);
  });

  it("rebuilds the file when the cleaned JSON is longer", () => {
    // 1e21 comes back as 1e+21, so the JSON grows even though `extras` goes.
    const numbers = Array(40).fill(1e21);
    const text = `{"asset":{"version":"2.0","extras":1},"n":[${numbers.map(() => "1e21").join(",")}]}`;
    const input = glbText(text, new Uint8Array([1, 2, 3, 4]));
    const out = stripMetadata(input, "model/gltf-binary");
    if (!out) throw new Error("refused");
    const read = readGlb(out);
    expect(out.length).toBeGreaterThan(input.length);
    expect(read.length).toBe(out.length);
    expect(read.jsonLength % 4).toBe(0);
    expect(read.json.asset).toEqual({ version: "2.0" });
    expect(read.json.n).toEqual(numbers);
    expect(Array.from(read.bin ?? [])).toEqual([1, 2, 3, 4]);
  });

  it("leaves a clean model as it was, and drops chunks after the binary one", () => {
    const clean = tinyGlb();
    expect(stripMetadata(clean.slice(), "model/gltf-binary")).toEqual(clean);
    const withBin = glb({ asset: { version: "2.0" } }, new Uint8Array([1, 2, 3, 4]));
    const extra = cat(withBin, [8, 0, 0, 0], "XTRA", "Ryan Oak");
    const view = new DataView(extra.buffer);
    view.setUint32(8, extra.length, true);
    const out = stripMetadata(extra, "model/gltf-binary");
    expect(out).toEqual(withBin);
  });

  it("refuses models it can't read", () => {
    const deep = `{"asset":{"version":"2.0"},"x":${"[".repeat(100_000)}${"]".repeat(100_000)}}`;
    const refused = [
      [
        "the wrong length in the header",
        cat(tinyGlb().subarray(0, 8), [0, 1, 0, 0], tinyGlb().subarray(12)),
      ],
      ["JSON that isn't JSON", glbText("{{{{")],
      ["JSON that isn't an object", glb([1, 2])],
      [
        "an image outside the binary chunk",
        glb(
          {
            asset: { version: "2.0" },
            buffers: [{ byteLength: 4 }],
            bufferViews: [{ buffer: 0, byteOffset: 2, byteLength: 400 }],
            images: [{ bufferView: 0 }],
          },
          new Uint8Array(4),
        ),
      ],
      [
        "an image that isn't base64",
        glb({ asset: { version: "2.0" }, images: [{ uri: "data:image/png,%89PNG" }] }),
      ],
      [
        "JSON over the cap",
        glb({ asset: { version: "2.0" }, pad: "x".repeat(MAX_GLB_JSON_BYTES) }),
      ],
    ] as const;
    for (const [why, file] of refused) {
      expect(stripMetadata(file.slice(), "model/gltf-binary"), why).toBeUndefined();
    }
    // Deep nesting is walked without recursion, so it's cleaned, not a crash.
    expect(stripMetadata(glbText(deep), "model/gltf-binary")).toBeDefined();
  });

  it("scrubs a texture once however many images point at it", () => {
    // A PNG of many empty chunks, slow to walk, behind a hundred thousand image entries.
    const chunks = Array.from({ length: 20_000 }, () => [
      0, 0, 0, 0, 0x61, 0x62, 0x43, 0x64, 0, 0, 0, 0,
    ]).flat();
    const texture = cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunks);
    const file = glb(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: texture.length }],
        bufferViews: [{ buffer: 0, byteLength: texture.length }],
        images: Array.from({ length: 100_000 }, () => ({ bufferView: 0 })),
      },
      texture,
    );
    const started = performance.now();
    expect(stripMetadata(file, "model/gltf-binary")).toBeDefined();
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("cuts external file paths down to the file name", () => {
    const out = stripMetadata(
      glb({
        asset: { version: "2.0" },
        buffers: [{ uri: "/home/ryan/scans/mesh.bin", byteLength: 4 }],
        images: [{ uri: "C:\\Users\\ryan\\Pictures\\IMG_1234.jpg" }],
      }),
      "model/gltf-binary",
    );
    if (!out) throw new Error("refused");
    const { json } = readGlb(out);
    expect(json.buffers[0].uri).toBe("mesh.bin");
    expect(json.images[0].uri).toBe("IMG_1234.jpg");
  });

  it("survives truncated and corrupted models without throwing", () => {
    fuzz(model(), (b) => stripMetadata(b, "model/gltf-binary"));
  });

  it("scrubs WebP textures and leaves unknown formats alone", () => {
    const webp = cat(
      "RIFF",
      [38, 0, 0, 0],
      "WEBP",
      "VP8X",
      [10, 0, 0, 0],
      [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "EXIF",
      [8, 0, 0, 0],
      "GPS 37.7",
    );
    expect(scrubImage(webp)).toBe(true);
    expect(asText(webp)).not.toContain("GPS");
    expect(asText(webp)).toContain("JUNK");
    expect(webp[20]).toBe(0);
    const ktx = cat("\xabKTX 20\xbb", "location 37.7749");
    expect(scrubImage(ktx)).toBe(false);
  });
});
