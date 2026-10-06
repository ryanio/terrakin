import type { WorldState } from "./types";

/**
 * Serialize any plain JSON value with object keys sorted, so equal states always produce
 * byte-identical strings regardless of insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex chars. Fast and portable, not cryptographic. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Fingerprint of a world state. Two servers that agree on this agree on the world. */
export function hashWorld(state: WorldState): string {
  return fnv1a(canonicalJson(state));
}
