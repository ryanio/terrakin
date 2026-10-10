import { createHash } from "node:crypto";

/**
 * Random bytes, bytes as text, the ids made from them, and SHA-256. Everything here runs the same
 * on Node and Cloudflare Workers.
 */

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

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
