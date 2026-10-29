import { createHash } from "node:crypto";

/**
 * Random bytes, bytes as text, the ids made from them, and SHA-256. Everything here runs the same
 * on Node and Cloudflare Workers.
 */

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Bytes `start` to `end` as text, a character a byte: a magic number or a four-character code. */
export const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

export const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * Bytes from base64url, or undefined when the text isn't base64url. WebAuthn sends every binary
 * field this way, and all of it is hostile input, so an unpadded length, a stray character or a
 * wrong alphabet is a refusal rather than a throw.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

/** SHA-256 of bytes, as bytes. `sha256Hex` is the same digest for a string, as hex. */
export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  // Copied first, so a view onto any buffer (a TextEncoder's, a subarray) is one the Workers
  // types accept as a BufferSource.
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));
}

/**
 * Whether two byte strings match, in time that doesn't depend on where they differ. A WebAuthn
 * challenge is a secret until it's used, so it is compared with this and not with a loop that stops.
 */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** A record's id: its prefix and 16 random hex characters (`r_`, `p_`, `rep_`). */
export const randomId = (prefix: string) => `${prefix}_${toHex(randomBytes(8))}`;

/**
 * SHA-256 of `text` (as UTF-8) in hex, for a caller that can wait: Web Crypto, which only hashes
 * asynchronously.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

/**
 * The same hash for a caller that can't wait: a token or key is looked up in the middle of a
 * synchronous call, and a snapshot is checked during boot. Web Crypto has no synchronous digest,
 * so this one is `node:crypto`, which the Worker has through `nodejs_compat` (wrangler.jsonc). It
 * lives here with the async one so there is one place to look, and both give the same hex.
 *
 * Tokens, link keys, codes, and staff keys are stored as this hash. Changing what it returns for
 * a given text locks every one of them out; `bytes.test.ts` pins it.
 */
export const sha256HexSync = (text: string) => createHash("sha256").update(text).digest("hex");
