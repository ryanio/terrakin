/**
 * The feelings a figure can show (RFC 0013). One fixed list, shared by the 2D figure and the 3D
 * peg. A feeling is a name from this list, never text. The list moves to `protocol/` when the
 * server can send one (`emote`), and only ever grows.
 */
export const FEELINGS = [
  "neutral",
  "happy",
  "laugh",
  "love",
  "shy",
  "surprised",
  "sad",
  "sleepy",
  "thinking",
] as const;

export type Feeling = (typeof FEELINGS)[number];

/** True for a name on the list. */
export const isFeeling = (value: unknown): value is Feeling =>
  (FEELINGS as readonly unknown[]).includes(value);
