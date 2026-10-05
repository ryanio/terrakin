import { describe, expect, it } from "vitest";
import { imageSize, MAX_IMAGE_SIDE, sizeFields } from "./image-size";
import { cat } from "./media-fixtures";

const be16 = (n: number) => [n >> 8, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, n >> 8];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

const png = (w: number, h: number) =>
  cat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    "IHDR",
    be32(w),
    be32(h),
    [8, 6, 0, 0, 0],
  );
const gif = (w: number, h: number) => cat("GIF89a", le16(w), le16(h), [0, 0, 0]);
const riff = (chunk: string, data: number[]) =>
  cat("RIFF", [0, 0, 0, 0], "WEBP", chunk, [data.length, 0, 0, 0], data);
const webpVp8x = (w: number, h: number) =>
  riff("VP8X", [0x10, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const webpLossy = (w: number, h: number) =>
  riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0]);
function webpLossless(w: number, h: number) {
  const bits = (w - 1) | ((h - 1) << 14);
  return riff("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, bits >>> 24, 0]);
}

/** A JPEG's EXIF segment with only an orientation, as the stripper writes it. */
const orientation = (o: number) =>
  cat(
    [0xff, 0xe1, 0, 34],
    "Exif\0\0",
    [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0],
    [0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0],
  );
const jpeg = (w: number, h: number, ...before: Uint8Array[]) =>
  cat(
    [0xff, 0xd8],
    [0xff, 0xe0, 0, 4, 0, 0],
    ...before,
    [0xff, 0xc0, 0, 11, 8, ...be16(h), ...be16(w), 1, 1, 0x11, 0],
    [0xff, 0xda, 0, 2, 0x11, 0xff, 0xd9],
  );

/** A small seeded generator, so a failing mutation can be replayed. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("imageSize", () => {
  it("reads PNG, GIF, all three kinds of WebP, and JPEG headers", () => {
    expect(imageSize(png(1200, 800), "image/png")).toEqual({ width: 1200, height: 800 });
    expect(imageSize(gif(320, 240), "image/gif")).toEqual({ width: 320, height: 240 });
    expect(imageSize(webpVp8x(4000, 3000), "image/webp")).toEqual({ width: 4000, height: 3000 });
    expect(imageSize(webpLossy(640, 480), "image/webp")).toEqual({ width: 640, height: 480 });
    expect(imageSize(webpLossless(333, 777), "image/webp")).toEqual({ width: 333, height: 777 });
    expect(imageSize(jpeg(1600, 900), "image/jpeg")).toEqual({ width: 1600, height: 900 });
  });

  it("turns a JPEG's size the way its EXIF rotation shows it", () => {
    expect(imageSize(jpeg(4032, 3024, orientation(6)), "image/jpeg")).toEqual({
      width: 3024,
      height: 4032,
    });
    expect(imageSize(jpeg(4032, 3024, orientation(3)), "image/jpeg")).toEqual({
      width: 4032,
      height: 3024,
    });
  });

  it("finds the EXIF rotation after the frame header too, where the stripper puts it", () => {
    const sof = (w: number, h: number) =>
      cat([0xff, 0xc0, 0, 11, 8, ...be16(h), ...be16(w), 1, 1, 0x11, 0]);
    const late = cat(
      [0xff, 0xd8],
      sof(4032, 3024),
      orientation(6),
      [0xff, 0xda, 0, 2, 0x11, 0xff, 0xd9],
    );
    expect(imageSize(late, "image/jpeg")).toEqual({ width: 3024, height: 4032 });
  });

  it("steps over fill bytes and other segments before the frame", () => {
    const filled = cat([0xff, 0xd8, 0xff], jpeg(10, 20).subarray(2));
    expect(imageSize(filled, "image/jpeg")).toEqual({ width: 10, height: 20 });
    const tables = cat([0xff, 0xc4, 0, 4, 0, 0]);
    expect(imageSize(jpeg(10, 20, tables), "image/jpeg")).toEqual({ width: 10, height: 20 });
  });

  it("leaves out what it can't read, sides of zero, and sides too big to be real", () => {
    expect(imageSize(png(0, 10), "image/png")).toBeUndefined();
    expect(imageSize(png(MAX_IMAGE_SIDE + 1, 10), "image/png")).toBeUndefined();
    expect(imageSize(jpeg(10, 0), "image/jpeg")).toBeUndefined();
    expect(imageSize(cat([0xff, 0xd8], [0xff, 0xda, 0, 2]), "image/jpeg")).toBeUndefined();
    expect(imageSize(riff("ALPH", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "image/webp")).toBeUndefined();
    expect(imageSize(png(10, 10), "video/mp4")).toBeUndefined();
    expect(imageSize(new Uint8Array(0), "image/gif")).toBeUndefined();
  });

  it("survives every truncation and random corruption without throwing", () => {
    const files: [Uint8Array, Parameters<typeof imageSize>[1]][] = [
      [png(100, 50), "image/png"],
      [gif(100, 50), "image/gif"],
      [webpVp8x(100, 50), "image/webp"],
      [webpLossless(100, 50), "image/webp"],
      [jpeg(100, 50, orientation(8)), "image/jpeg"],
    ];
    const next = random(11);
    for (const [file, type] of files) {
      for (let n = 0; n < file.length; n++) {
        const size = imageSize(file.slice(0, n), type);
        if (size) expect(size.width * size.height).toBeGreaterThan(0);
      }
      for (let round = 0; round < 2000; round++) {
        const copy = file.slice();
        const at = Math.floor(next() * copy.length);
        copy[at] = next() < 0.5 ? ([0, 0xff, 1][Math.floor(next() * 3)] ?? 0) : next() * 256;
        const size = imageSize(copy, type);
        if (size) {
          expect(Number.isInteger(size.width) && size.width > 0).toBe(true);
          expect(size.height).toBeLessThanOrEqual(MAX_IMAGE_SIDE);
        }
      }
    }
  });

  it("walks a cap-sized JPEG of tiny segments, or of fill bytes, in one quick pass", () => {
    const size = 5_000_000;
    const segments = new Uint8Array(size);
    segments.set([0xff, 0xd8]);
    for (let i = 2; i + 4 <= size; i += 4) segments.set([0xff, 0xfe, 0, 2], i);
    const fill = new Uint8Array(size).fill(0xff);
    fill.set([0xff, 0xd8]);
    const started = performance.now();
    expect(imageSize(segments, "image/jpeg")).toBeUndefined();
    expect(imageSize(fill, "image/jpeg")).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("sizeFields", () => {
  it("adds a size only when the row has both sides", () => {
    expect(sizeFields({ width: 4, height: 3 })).toEqual({ width: 4, height: 3 });
    expect(sizeFields({ width: null, height: null })).toEqual({});
    expect(sizeFields({ width: 4 })).toEqual({});
  });
});
