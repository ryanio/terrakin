import { createHash } from "node:crypto";

/**
 * The byte helpers `workers-start/bytes` has no match for. Hex, base64url, random bytes and ids,
 * SHA-256 and the constant-time compare come from there.
 */

/** Bytes `start` to `end` as text, a character a byte: a magic number or a four-character code. */
export const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

/**
 * SHA-256 of `text` (as UTF-8) in hex, for a caller that can't wait: a token or key is looked up
 * in the middle of a synchronous call, and a snapshot is checked during boot. Web Crypto has no
 * synchronous digest, so this one is `node:crypto`, which the Worker has through `nodejs_compat`
 * (wrangler.jsonc). It gives the same hex as `sha256Hex` from `workers-start/bytes`.
 *
 * Tokens, link keys, codes, and staff keys are stored as this hash. Changing what it returns for
 * a given text locks every one of them out; `bytes.test.ts` pins it.
 */
export const sha256HexSync = (text: string) => createHash("sha256").update(text).digest("hex");
