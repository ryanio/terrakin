import type { MediaType } from "@terrakin/protocol";

/**
 * Where uploaded files go. R2 on Cloudflare, a directory or memory locally. Serving is the
 * adapter's job (the Worker reads R2 directly), so the service only ever writes.
 */
export interface MediaStore {
  put(id: string, bytes: Uint8Array, type: MediaType): Promise<void>;
}

/** A store the Node server can also read back from, to serve `/media/:id` itself. */
export interface ReadableMediaStore extends MediaStore {
  get(id: string): Promise<Uint8Array | undefined>;
}

export class MemoryMediaStore implements ReadableMediaStore {
  readonly files = new Map<string, Uint8Array>();
  async put(id: string, bytes: Uint8Array) {
    this.files.set(id, bytes);
  }
  async get(id: string) {
    return this.files.get(id);
  }
}

/** Media ids as the server makes them. Anything else in a `/media/` path is refused before any lookup. */
export const MEDIA_ID = /^m_[0-9a-f]{16}$/;

/**
 * Headers for serving an upload. The type is the one we checked, `nosniff` stops browsers from
 * guessing another, and the sandbox CSP means even a file opened directly can't run anything.
 */
export function mediaHeaders(type: MediaType): Record<string, string> {
  return {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": "public, max-age=31536000, immutable",
  };
}

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

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
  // ISO base media (MP4). QuickTime (`qt  `) is refused: most browsers can't play it inline.
  if (ascii(b, 4, 8) === "ftyp" && ascii(b, 8, 12) !== "qt  ") return "video/mp4";
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
