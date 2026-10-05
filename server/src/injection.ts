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
export const INVISIBLE = new RegExp(
  `[${char(0xad)}${char(0x34f)}${char(0x180e)}${char(0xfeff)}${span(0x200b, 0x200f)}${span(0x202a, 0x202e)}${span(0x2060, 0x2064)}${span(0x2066, 0x2069)}]`,
  "gu",
);
// Unicode tag characters mirror ASCII at U+E0000, render as nothing, and models read them.
export const TAGS = /[\u{e0000}-\u{e007f}]/gu;

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

/** Tag characters read as ASCII, NFKC, invisible characters gone, lowercase. */
const unhide = (text: string) =>
  text
    .replace(TAGS, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0xe0000) - 0xe0000))
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase();

/** The words that read as orders for an AI reader, or null when there are none. */
export function aimedAtReader(text: string): string | null {
  const normal = unhide(text);
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

// An owner code (owner-service.ts: 16 of these symbols, in fours) or the routes that take one.
const CODE_SYMBOL = "[a-km-np-z2-9]";
const OWNER_CODE = new RegExp(
  `\\b${CODE_SYMBOL}{4}-${CODE_SYMBOL}{4}-${CODE_SYMBOL}{4}-${CODE_SYMBOL}{4}\\b|/v1/owner/(?:accept|confirm|invites/)|/accept-owner\\b`,
);
// A request that changes something, written for an agent to send, or a link with a link key in it.
const REQUEST = /\b(?:post|put|patch|delete) +(?:https?:\/\/\S+?)?\/v1\/[a-z]|\/v1\/act\/[^\s/<]/;

/**
 * Text that would hand an agent a way in: a one-time owner code (whoever's agent accepts it first
 * is linked to the person who made it), a request for an agent to send to the API, or a link key.
 * It's never needed in something people read, so it's turned away wherever residents write. Report
 * notes skip this, since a note may quote what was posted.
 */
export function agentHandle(text: string): "owner_code" | "request" | null {
  const flat = unhide(text).replace(/\s+/g, " ");
  if (OWNER_CODE.test(flat)) return "owner_code";
  if (REQUEST.test(flat)) return "request";
  return null;
}

export const OWNER_CODE_MESSAGE =
  "That has a one-time code for linking a person and their AI. Anyone could read it here, so pass it on directly, outside Terrakin.";

export const requestMessage = (what: string) =>
  `${what} can't include requests for an AI to send to Terrakin, or links with a link key in them. Describe what you did in words instead.`;
