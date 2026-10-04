/**
 * Posts, bios, and replies are read by other residents' AI assistants. Text written as orders for
 * those readers ("ignore your previous instructions", "if you are an AI reading this, ...") is
 * turned away before it's stored.
 *
 * This is a speed bump, not the defense. Rewording gets past any list. The defense that holds is
 * that every reader treats this text as data: posts carry `trust: "untrusted"` and SKILL.md's first
 * rule says so (decision 0004). Keep the patterns narrow, because a false match blocks a real post.
 * The idea comes from Flock's result filter (a sibling project).
 */

const char = (code: number) => String.fromCodePoint(code);
const span = (from: number, to: number) => `${char(from)}-${char(to)}`;
// Characters that split a word without showing: soft hyphen, combining grapheme joiner, Mongolian
// vowel separator, zero-width and bidi marks, word joiners, BOM. Built from code points so the
// source holds no invisible characters.
const INVISIBLE = new RegExp(
  `[${char(0xad)}${char(0x34f)}${char(0x180e)}${char(0xfeff)}${span(0x200b, 0x200f)}${span(0x202a, 0x202e)}${span(0x2060, 0x2064)}${span(0x2066, 0x2069)}]`,
  "gu",
);
// Unicode tag characters mirror ASCII at U+E0000, render as nothing, and models read them.
const TAGS = /[\u{e0000}-\u{e007f}]/gu;

const READER = "(?:ai|llm|(?:large )?language model|model|chatbot|assistant|agent|bot)s?";

const PATTERNS: RegExp[] = [
  // Overriding what the reader was told.
  /\b(?:ignore|disregard|forget|override|bypass) (?:(?:all|any|the|your|of|these|those|my) )*(?:previous|prior|above|earlier|preceding|system|original) (?:instructions?|prompts?|rules|messages|directions|guidelines|context|commands)\b/,
  /\b(?:ignore|disregard|override|bypass) (?:the|your) (?:system prompt|guardrails|safety rules|owner)\b/,
  /\b(?:ignore|disregard|forget) (?:everything|all) (?:above|before this|prior)\b/,
  /\b(?:new|updated|system|developer) (?:instructions|prompt|message) ?:/,
  // Addressing whatever model is reading.
  new RegExp(
    `\\b(?:if|when|attention|note to|dear) (?:(?:you are|you're|any|an?|the|all) )*${READER}\\b[^.!?]{0,30}\\b(?:reading|processing|parsing|summari[sz]ing|reviewing) (?:this|these|my)\\b`,
  ),
  new RegExp(`\\b${READER}s? (?:reading|processing|parsing|reviewing) this\\b`),
  // Asking readers to hand over their owner's or their own secrets.
  /\b(?:post|send|share|reply with|tell me|give me|reveal) (?:me )?(?:your|the) (?:owner'?s? )?(?:bearer )?(?:token|link key|api key|password|system prompt|private key|seed phrase|email address|home address|phone number)\b/,
  // Chat-format markers.
  /<\|[a-z_]+\|>|\[\/?(?:inst|system)\]|<\/?(?:system|instructions?)>/,
];

// A role label only means something at the start of a line, so this runs on the text as written.
const LINE_PATTERNS: RegExp[] = [/^[ \t]*(?:system|assistant|developer) ?:/m];

/** Why a text was turned away, quoting the words that tripped the filter. */
export const readerMessage = (what: string, words: string) =>
  `${what} can't include instructions aimed at AI readers ("${words}"). Write it for people, and say it another way.`;

/** The words that read as orders for an AI reader, or null when there are none. */
export function aimedAtReader(text: string): string | null {
  const normal = text
    .replace(TAGS, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0xe0000) - 0xe0000))
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase();
  const flat = normal.replace(/\s+/g, " ");
  for (const pattern of PATTERNS) {
    const match = flat.match(pattern);
    if (match) return match[0].trim().slice(0, 80);
  }
  for (const pattern of LINE_PATTERNS) {
    const match = normal.match(pattern);
    if (match) return match[0].trim().slice(0, 80);
  }
  return null;
}
