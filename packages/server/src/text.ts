import { NAME_MAX_LENGTH } from "@terrakin/sim";

// C0/C1 control characters plus bidi overrides and zero-width characters, which can be used to
// disguise text. Newlines are dropped too: chat is single-line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** Normalize user text for display. The result is still untrusted and must render as plain text. */
export function cleanText(input: string): string {
  return input.normalize("NFC").replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
}

/**
 * What two resident names are compared on (decision 0148): compatibility forms folded (a
 * fullwidth "Ｗ" is a "W"), invisible characters dropped (soft hyphens, joiners, variation
 * selectors, fillers), spaces collapsed, and case ignored. Only for comparing: a name is stored
 * and shown as it was logged.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Numbers `freeNames` tries after a name, in order. */
const SUFFIXES = Array.from({ length: 19 }, (_, i) => i + 2);

/**
 * Up to `count` free names near `held`, for a join refused as `name_taken` (decision 0148): the
 * name with a number after it, from 2 up. `isTaken` says whether one is spoken for.
 *
 * `held` is the stored name of the resident who holds it, so it has already been cleaned and
 * filtered. Never build these from what the caller typed: the link join checks a name against
 * the world before the filters see it, so that text isn't ours to repeat.
 */
export function freeNames(held: string, isTaken: (name: string) => boolean, count = 3): string[] {
  const free: string[] = [];
  // Room for the longest suffix this tries, so a name at the cap still gets suggestions.
  const base = cleanText(held)
    .slice(0, NAME_MAX_LENGTH - 3)
    .trim();
  if (!base) return free;
  for (const n of SUFFIXES) {
    if (free.length >= count) break;
    const candidate = `${base} ${n}`;
    if (!isTaken(candidate)) free.push(candidate);
  }
  return free;
}

// The same as UNSAFE, minus the newline, for text where line breaks are allowed.
const UNSAFE_MULTILINE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Like `cleanText`, but keeps line breaks (at most one blank line in a row). Still untrusted. */
export function cleanMultiline(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE_MULTILINE, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
