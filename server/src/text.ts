// C0/C1 control characters plus bidi overrides and zero-width characters, which can be used to
// disguise text. Newlines are dropped too: chat is single-line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** Normalize user text for display. The result is still untrusted and must render as plain text. */
export function cleanText(input: string): string {
  return input.normalize("NFC").replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
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
