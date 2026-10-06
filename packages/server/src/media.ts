import { MEDIA_TYPES, type MediaType } from "@terrakin/protocol";

/**
 * Where uploaded files go. R2 on Cloudflare, a directory or memory locally. Serving public media
 * is the adapter's job (the Worker reads R2 directly). The service reads files back only to move
 * letter images to their private key and to serve them to the letter's two residents.
 *
 * Keys are a media id (`m_...`, public at `/media/<id>`) or a private key from `privateMediaKey`,
 * which no public path ever serves.
 */
export interface MediaStore {
  put(key: string, bytes: Uint8Array, type: MediaType): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}

/** Kept for the Node adapter's signature; every store can read now. */
export type ReadableMediaStore = MediaStore;

export class MemoryMediaStore implements ReadableMediaStore {
  readonly files = new Map<string, Uint8Array>();
  async put(id: string, bytes: Uint8Array) {
    this.files.set(id, bytes);
  }
  async get(id: string) {
    return this.files.get(id);
  }
  async delete(id: string) {
    this.files.delete(id);
  }
}

/** Media ids as the server makes them. Anything else in a `/media/` path is refused before any lookup. */
export const MEDIA_ID = /^m_[0-9a-f]{16}$/;

/**
 * Where a letter's image lives once attached. The prefix keeps it out of `/media/<id>` on both
 * runtimes (that path only accepts `MEDIA_ID`), so only the authenticated letter route serves it.
 */
export const privateMediaKey = (id: string) => `letter-${id}`;

/** Any key a media store may hold: a public media id or a private letter key. */
export const STORE_KEY = /^(letter-)?m_[0-9a-f]{16}$/;

/**
 * Headers for serving an upload. The type is the one we checked, `nosniff` stops browsers from
 * guessing another, and the sandbox CSP means even a file opened directly can't run anything.
 * Cached for an hour, not forever, so a deleted file stops being served soon after.
 */
export function mediaHeaders(type: MediaType): Record<string, string> {
  return {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": "public, max-age=3600",
  };
}

/**
 * Read a body stream, giving up as soon as it passes `maxBytes`. Never trusts Content-Length, so a
 * chunked or lying request can't make the server buffer more than the cap.
 */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

/** ISO base media brands that browsers play as MP4. HEIC, AVIF, M4A, 3GP and QuickTime aren't here. */
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
  "dash",
]);

/**
 * The real type of an upload, from its first bytes. The client's Content-Type is never trusted:
 * anything that isn't one of the allowed formats (SVG, HTML, scripts, archives) comes back undefined.
 */
export function sniffMediaType(bytes: Uint8Array): MediaType | undefined {
  const b = bytes;
  if (b.length < 12) return undefined;
  if (b[0] === 0x89 && ascii(b, 1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) {
    return "image/png";
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (ascii(b, 4, 8) === "ftyp" && MP4_BRANDS.has(ascii(b, 8, 12))) return "video/mp4";
  // Matroska, but only the WebM profile, which browsers play.
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return ascii(b, 0, Math.min(b.length, 64)).includes("webm") ? "video/webm" : undefined;
  }
  // glTF binary container, version 2.
  if (ascii(b, 0, 4) === "glTF" && b[4] === 2 && b[5] === 0 && b[6] === 0 && b[7] === 0) {
    return "model/gltf-binary";
  }
  return undefined;
}

/** The slice of an R2 bucket that `serveFromBucket` uses, so tests can fake it. */
export interface MediaBucket {
  get(
    key: string,
    options: { range?: Headers; onlyIf?: Headers },
  ): Promise<{
    size: number;
    httpEtag: string;
    httpMetadata?: { contentType?: string };
    range?: { offset?: number; length?: number; suffix?: number };
    body?: ReadableStream;
  } | null>;
  head(key: string): Promise<{ size: number } | null>;
}

const notFound = () =>
  new Response(JSON.stringify({ error: { code: "not_found", message: "Not found." } }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

/** Serve an upload from R2, with byte ranges (phones stream video this way) and ETag revalidation. */
export async function serveFromBucket(
  bucket: MediaBucket,
  id: string,
  request: Request,
): Promise<Response> {
  if (!MEDIA_ID.test(id)) return notFound();
  // Only revalidation preconditions. A failed If-None-Match is a 304; other preconditions aren't
  // something a media URL needs.
  const onlyIf = new Headers();
  for (const name of ["if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) onlyIf.set(name, value);
  }
  let object: Awaited<ReturnType<MediaBucket["get"]>>;
  try {
    object = await bucket.get(id, {
      ...(request.headers.has("range") ? { range: request.headers } : {}),
      onlyIf,
    });
  } catch {
    // R2 rejects a range it can't satisfy.
    const head = await bucket.head(id);
    if (!head) return notFound();
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${head.size}` },
    });
  }
  if (!object) return notFound();
  const type = object.httpMetadata?.contentType;
  // Only types we wrote ourselves after checking the bytes.
  if (!type || !(type in MEDIA_TYPES)) return notFound();
  const headers = new Headers(mediaHeaders(type as MediaType));
  headers.set("accept-ranges", "bytes");
  headers.set("etag", object.httpEtag);
  if (!object.body) return new Response(null, { status: 304, headers });
  const body = request.method === "HEAD" ? null : object.body;
  const range = object.range;
  if (request.headers.has("range") && range) {
    const offset =
      range.suffix !== undefined ? Math.max(0, object.size - range.suffix) : (range.offset ?? 0);
    const length =
      range.suffix !== undefined ? object.size - offset : (range.length ?? object.size - offset);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(body, { headers });
}
