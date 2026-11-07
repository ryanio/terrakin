/**
 * WebP on cards. resvg 2.6.2 reads a WebP's size but draws nothing for it, so the renderer decodes
 * each WebP itself (libwebp, from @jsquash/webp) and hands resvg a PNG instead. Only the renderer
 * does this, and only for the picture it is about to draw: the upload is never changed.
 *
 * The bytes are hostile. `imageDataUri` has already capped the file and checked the header's size
 * against `MAX_WEBP_PIXELS`, which libwebp decodes to. Anything libwebp refuses, or a result that
 * isn't that size, leaves the card without the picture.
 */

import factory from "@jsquash/webp/codec/dec/webp_dec.js";
import { base64, MAX_WEBP_PIXELS, probeImage } from "./images";

/**
 * Longest side of the PNG made from a WebP. The biggest box a card draws a picture in is a home
 * picture on a posted plot photo, about 450 pixels across.
 */
const MAX_SIDE = 640;

interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface WebpModule {
  decode(data: Uint8Array): Pixels | null;
}

/**
 * The WebAssembly global, typed here by hand: the server type-checks this file with no DOM or
 * Workers types, which are where `WebAssembly` is declared.
 */
const wasmApi = (
  globalThis as unknown as {
    WebAssembly: {
      Module: new (bytes: ArrayBuffer) => object;
      Instance: new (module: object, imports: object) => { exports: object };
    };
  }
).WebAssembly;

/** A WebP data URI as a PNG one, or undefined when it can't be decoded. */
export type WebpToPng = (uri: string) => Promise<string | undefined>;

/**
 * The converter for one isolate or process, from libwebp's decoder: compiled (a Worker's `.wasm`
 * import, since a Worker can't compile wasm at run time) or its bytes (Node). It is instantiated on
 * the first WebP, so a card without one costs nothing more.
 */
export function webpToPng(wasm: object | ArrayBuffer): WebpToPng {
  let module: Promise<WebpModule> | undefined;
  const start = () => {
    const compiled = wasm instanceof ArrayBuffer ? new wasmApi.Module(wasm) : wasm;
    return (factory as (o: object) => Promise<WebpModule>)({
      noInitialRun: true,
      instantiateWasm: (imports: object, done: (instance: { exports: object }) => void) => {
        const instance = new wasmApi.Instance(compiled, imports);
        done(instance);
        return instance.exports;
      },
    });
  };
  const ready = () => {
    module ??= start();
    module.catch(() => {
      module = undefined;
    });
    return module;
  };
  return async (uri) => {
    try {
      const bytes = fromBase64(uri.slice(uri.indexOf(",") + 1));
      const probe = probeImage(bytes);
      if (probe?.type !== "image/webp" || probe.width * probe.height > MAX_WEBP_PIXELS) return;
      const pixels = (await ready()).decode(bytes);
      if (!pixels || pixels.width !== probe.width || pixels.height !== probe.height) return;
      if (pixels.data.length !== pixels.width * pixels.height * 4) return;
      const small = shrink(pixels);
      return `data:image/png;base64,${base64(await encodePng(small))}`;
    } catch {
      return undefined;
    }
  };
}

/**
 * The picture scaled down to fit `MAX_SIDE`, each pixel the alpha-weighted mean of the source
 * pixels that fall in it. One pass over the source, adding each pixel to the one it lands in.
 */
function shrink(p: Pixels): Pixels {
  const scale = Math.min(1, MAX_SIDE / Math.max(p.width, p.height));
  if (scale === 1) return p;
  const width = Math.max(1, Math.round(p.width * scale));
  const height = Math.max(1, Math.round(p.height * scale));
  // Per pixel of the result: red, green and blue each times alpha, then alpha, then a count.
  const sums = new Float64Array(width * height * 5);
  const column = Int32Array.from({ length: p.width }, (_, x) =>
    Math.min(width - 1, Math.floor((x * width) / p.width)),
  );
  const src = p.data;
  for (let y = 0; y < p.height; y++) {
    const row = Math.min(height - 1, Math.floor((y * height) / p.height)) * width;
    for (let x = 0, i = y * p.width * 4; x < p.width; x++, i += 4) {
      const o = (row + (column[x] as number)) * 5;
      const alpha = src[i + 3] as number;
      sums[o] = (sums[o] as number) + (src[i] as number) * alpha;
      sums[o + 1] = (sums[o + 1] as number) + (src[i + 1] as number) * alpha;
      sums[o + 2] = (sums[o + 2] as number) + (src[i + 2] as number) * alpha;
      sums[o + 3] = (sums[o + 3] as number) + alpha;
      sums[o + 4] = (sums[o + 4] as number) + 1;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let k = 0; k < width * height; k++) {
    const a = sums[k * 5 + 3] as number;
    const count = sums[k * 5 + 4] as number;
    if (a > 0) {
      data[k * 4] = (sums[k * 5] as number) / a;
      data[k * 4 + 1] = (sums[k * 5 + 1] as number) / a;
      data[k * 4 + 2] = (sums[k * 5 + 2] as number) / a;
    }
    data[k * 4 + 3] = count > 0 ? a / count : 0;
  }
  return { data, width, height };
}

/** An RGBA PNG, each row Sub-filtered and deflated by the runtime's own `CompressionStream`. */
async function encodePng(p: Pixels): Promise<Uint8Array> {
  const stride = p.width * 4;
  const raw = new Uint8Array((stride + 1) * p.height);
  for (let y = 0; y < p.height; y++) {
    const row = y * (stride + 1);
    const from = y * stride;
    raw[row] = 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? (p.data[from + i - 4] ?? 0) : 0;
      raw[row + 1 + i] = (p.data[from + i] ?? 0) - left;
    }
  }
  const deflated = new Uint8Array(
    await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, p.width);
  view.setUint32(4, p.height);
  header.set([8, 6, 0, 0, 0], 8);
  return concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", header),
    chunk("IDAT", deflated),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function fromBase64(s: string): Uint8Array {
  const text = atob(s);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}
