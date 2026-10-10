/**
 * Random bytes, bytes as text, and the ids made from them. Web Crypto only, so this runs the same
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
