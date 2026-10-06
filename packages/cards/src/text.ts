/**
 * Text helpers. Every string on a card that a resident wrote (names, bios, posts) passes through
 * `cardText()` and then `clip()` before layout: satori wraps text but never shortens it, and it
 * draws a box for any character the bundled fonts don't have.
 */

/**
 * What the bundled fonts can draw: the latin and latin-ext subsets of Fraunces and Figtree, minus
 * invisible and direction-changing characters. Ranges from @fontsource's unicode.json.
 */
const DRAWABLE = new RegExp(
  "[" +
    [
      "\\u0020-\\u007E",
      "\\u00A0-\\u02FF",
      "\\u0304\\u0308\\u0329",
      "\\u1D00-\\u1DBF",
      "\\u1E00-\\u1E9F",
      "\\u1EF2-\\u1EFF",
      "\\u2010-\\u2027",
      "\\u2030-\\u205E",
      "\\u20A0-\\u20C0",
      "\\u2113\\u2122\\u2191\\u2193\\u2212\\u2215",
      "\\u2C60-\\u2C7F",
      "\\uA720-\\uA7FF",
    ].join("") +
    "]",
);

export interface CleanText {
  text: string;
  /** Share of the visible characters that were dropped (emoji, scripts the fonts lack). 0 to 1. */
  dropped: number;
}

/**
 * Keeps what the fonts can draw and drops the rest: emoji, CJK, Cyrillic, symbols, control and
 * zero-width characters. Whitespace (including line breaks) collapses to single spaces.
 */
export function cardText(input: string): CleanText {
  const chars = [...input.normalize("NFC")];
  let visible = 0;
  let kept = 0;
  let out = "";
  for (const c of chars) {
    if (/\s/u.test(c)) {
      out += " ";
      continue;
    }
    visible++;
    if (DRAWABLE.test(c)) {
      kept++;
      out += c;
    }
  }
  // Dropping a word can strand its punctuation ("Привет, мир!" leaves ", !"), so lone marks go too.
  const text = out
    .split(/\s+/)
    .filter((word) => word && !/^[,.;:!?¡¿…·]+$/.test(word))
    .join(" ");
  return { text, dropped: visible === 0 ? 0 : (visible - kept) / visible };
}

/**
 * Text fit for a card, or undefined when too little of it survives `cardText()` to make sense
 * (a name or post written mostly in a script the fonts lack).
 */
export function drawable(input: string, max: number, keep = 0.6): string | undefined {
  const { text, dropped } = cardText(input);
  if (!text || 1 - dropped < keep) return undefined;
  return clip(text, max);
}

/** Cuts to at most `max` characters, on a word boundary when one is close, with an ellipsis. */
export function clip(s: string, max: number): string {
  const chars = [...s.trim().replace(/\s+/g, " ")];
  if (chars.length <= max) return chars.join("");
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?'"(-]+$/, "")}…`;
}

/**
 * The largest font size up to `max` that fits `s` on one line `width` px wide, given the font's
 * average advance as a fraction of the size.
 */
export function fit(s: string, width: number, max: number, advance: number, min = max / 2) {
  const n = Math.max(1, [...s].length);
  return Math.max(min, Math.min(max, Math.floor(width / (n * advance))));
}

/** 1234 -> "1,234", 12345 -> "12.3k", 1234567 -> "1.2M". */
export function count(n: number): string {
  const v = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  if (v < 10_000) return v.toLocaleString("en-US");
  if (v < 1_000_000) return `${trim(v / 1000)}k`;
  return `${trim(v / 1_000_000)}M`;
}

const trim = (n: number) => (n >= 100 ? String(Math.floor(n)) : n.toFixed(1).replace(/\.0$/, ""));

/** "1 post", "2 posts". */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${count(n)} ${n === 1 ? one : many}`;

/** "Oct 4, 2026", in UTC so a card is the same wherever it renders. Empty for a bad date. */
export function day(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
