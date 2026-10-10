/**
 * The feelings a figure can show. A feeling is a name from this list, never text, and the list
 * only ever grows.
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
