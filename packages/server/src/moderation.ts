import { FILTER_CATEGORIES, type FilterCategory } from "@terrakin/protocol";
import {
  agentHandle,
  aimedAtReader,
  INVISIBLE,
  OWNER_CODE_MESSAGE,
  readerMessage,
  requestMessage,
  TAGS,
} from "./injection";
import {
  ALLOW_PHRASES,
  ALLOW_WORDS,
  DENIED_DOMAINS,
  HATE_IN_WORDS,
  HATE_PHRASES,
  HATE_WORDS,
  IMPERSONATION_IN_NAMES,
  IMPERSONATION_IN_TEXT,
  SCAM_PATTERNS,
  SHORTENERS,
  THRESHOLDS,
  VULGAR_WORDS,
} from "./moderation-lists";

/**
 * The edge filters (RFC 0006, decision 0032). Every piece of text a resident writes passes through
 * `Moderation.review` before it's stored, logged in the world, or sent to anyone: names, handles,
 * notes, bios, posts, replies, letters, chat, gesture notes, gift notes, proposals, and notices.
 *
 * In order: text aimed at AI readers (injection.ts), hate, scams (including sounding like staff and
 * bad links), strong language, then spam. What each surface allows is `POLICY`; the words, patterns,
 * and numbers live in `moderation-lists.ts`.
 *
 * Like the injection filter, this is a speed bump. Rewording gets past any list, so reports and
 * maintainers are the backstop. False positives cost real people, so matching is on whole words
 * after normalizing, with an allowlist, and every list change ships with tests of sentences that
 * must still pass.
 *
 * Refusals never echo the matched words (except injection, whose words are a phrase, not a slur)
 * and are never logged with the text: only the category, the surface, and the resident id.
 */

export type Surface =
  | "name"
  | "handle"
  | "note"
  | "bio"
  | "post"
  | "reply"
  | "letter"
  | "chat"
  | "gesture_note"
  | "gift_note"
  | "item_label"
  | "pet_name"
  | "plot_name"
  | "proposal_title"
  | "proposal_text"
  | "bounty_title"
  | "bounty_text"
  | "event_title"
  | "event_text"
  | "notice";

type SpamCheck = "repeat" | "crowd" | "links" | "mentions" | "caps" | "runs";

interface Policy {
  /** How the text is named in refusals ("Names can't ..."). */
  label: string;
  /** Strong language: refused, allowed with a content warning, or allowed. */
  vulgar: "refuse" | "warn" | "allow";
  /** Sounding like the Terrakin team: the strict name rules, the phrase rules, or not checked. */
  impersonation: "name" | "text" | null;
  /** Refuse link shorteners. */
  shorteners: boolean;
  spam: readonly SpamCheck[];
}

const ALL_SPAM: readonly SpamCheck[] = ["repeat", "crowd", "links", "mentions", "caps", "runs"];

/** What each kind of text may hold. Private and fleeting text (letters, chat) may swear. */
export const POLICY: Record<Surface, Policy> = {
  name: {
    label: "Names",
    vulgar: "refuse",
    impersonation: "name",
    shorteners: true,
    spam: ["runs"],
  },
  // Handles also pass `isReservedHandle` (packages/protocol/src/routes.ts) first, which keeps route
  // words and names that start like staff ("admin_...", "terrakin...") for the team. This adds the
  // rest.
  handle: {
    label: "Handles",
    vulgar: "refuse",
    impersonation: "name",
    shorteners: false,
    spam: ["runs"],
  },
  note: {
    label: "Notes",
    vulgar: "refuse",
    impersonation: "text",
    shorteners: true,
    spam: ["runs"],
  },
  // Bios may say who runs a resident ("run by the Terrakin team" on a townsfolk bio); the name and
  // note are what people see next to every post, so those can't.
  bio: {
    label: "Bios",
    vulgar: "refuse",
    impersonation: null,
    shorteners: true,
    spam: ["links", "mentions", "caps", "runs"],
  },
  post: { label: "Posts", vulgar: "warn", impersonation: null, shorteners: false, spam: ALL_SPAM },
  reply: {
    label: "Replies",
    vulgar: "warn",
    impersonation: null,
    shorteners: false,
    spam: ALL_SPAM,
  },
  letter: {
    label: "Letters",
    vulgar: "allow",
    impersonation: null,
    shorteners: false,
    spam: ["links", "runs"],
  },
  chat: {
    label: "Chat",
    vulgar: "allow",
    impersonation: null,
    shorteners: false,
    spam: ["runs", "caps"],
  },
  gesture_note: {
    label: "Notes",
    vulgar: "allow",
    impersonation: null,
    shorteners: false,
    spam: ["runs"],
  },
  // A note on coins is where a scam would ask for more, so it checks staff-sounding text and links.
  gift_note: {
    label: "Gift notes",
    vulgar: "allow",
    impersonation: "text",
    shorteners: true,
    spam: ["runs"],
  },
  // A made thing's label goes wherever the thing goes, so it's held to the rules for notes.
  item_label: {
    label: "Labels",
    vulgar: "refuse",
    impersonation: "text",
    shorteners: true,
    spam: ["runs", "caps"],
  },
  // A pet's name is shown wherever the pet goes, next to its owner's: held to the rules for names.
  pet_name: {
    label: "Pet names",
    vulgar: "refuse",
    impersonation: "name",
    shorteners: true,
    spam: ["runs"],
  },
  // A plot's name is shown wherever the plot goes, on the map, cards, and pages: held to the
  // rules for names.
  plot_name: {
    label: "Plot names",
    vulgar: "refuse",
    impersonation: "name",
    shorteners: true,
    spam: ["runs"],
  },
  proposal_title: {
    label: "Proposals",
    vulgar: "refuse",
    impersonation: null,
    shorteners: false,
    spam: ["runs", "caps"],
  },
  proposal_text: {
    label: "Proposals",
    vulgar: "refuse",
    impersonation: null,
    shorteners: false,
    spam: ["links", "mentions", "runs", "caps"],
  },
  // A bounty asks people to do something for coins, which is where a scam would sound like staff.
  bounty_title: {
    label: "Bounties",
    vulgar: "refuse",
    impersonation: "text",
    shorteners: true,
    spam: ["runs", "caps"],
  },
  bounty_text: {
    label: "Bounties",
    vulgar: "refuse",
    impersonation: "text",
    shorteners: true,
    spam: ["links", "mentions", "runs", "caps"],
  },
  // An event invites people somewhere, which is where a lure would sound like staff (RFC 0010).
  event_title: {
    label: "Events",
    vulgar: "refuse",
    impersonation: "text",
    shorteners: true,
    spam: ["runs", "caps"],
  },
  event_text: {
    label: "Events",
    vulgar: "refuse",
    impersonation: "text",
    shorteners: true,
    spam: ["links", "mentions", "runs", "caps"],
  },
  notice: {
    label: "Notices",
    vulgar: "refuse",
    impersonation: null,
    shorteners: false,
    spam: ["repeat", "links", "mentions", "runs", "caps"],
  },
};

// ---------- normalizing ----------

const MARKS = /\p{M}+/gu;

/** Latin lookalikes from Cyrillic and Greek, after lowercasing. */
const CONFUSABLES: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ї: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ԛ: "q",
  ԝ: "w",
  ɡ: "g",
  α: "a",
  β: "b",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
};
const CONFUSABLE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

/** Leetspeak, folded only inside words that have a letter in them, so plain numbers stay. */
const LEET: Record<string, string> = {
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "i",
  "+": "t",
};

/**
 * The text as the scam and link patterns see it: Unicode tag characters read as ASCII, NFKC (so
 * full-width and styled letters become plain), lowercase, accents and invisible characters gone,
 * Cyrillic and Greek lookalikes folded, whitespace collapsed.
 */
export function plainText(text: string): string {
  return text
    .replace(TAGS, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0xe0000) - 0xe0000))
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(MARKS, "")
    .replace(CONFUSABLE, (c) => CONFUSABLES[c] ?? c)
    .replace(/\s+/g, " ")
    .trim();
}

export interface Normalized {
  /** See `plainText`. */
  plain: string;
  /** Each word's spellings to try: as folded, with long repeats cut to two, and cut to one. */
  words: string[][];
  /** The words joined by single spaces, for phrase patterns. */
  joined: string;
}

const hasRun = (w: string) => /(.)\1\1/.test(w);
const cutToTwo = (w: string) => w.replace(/(.)\1{2,}/g, "$1$1");
const cutToOne = (w: string) => w.replace(/(.)\1+/g, "$1");

/** Fold one word's leetspeak, with `1` read as `one` ("i" or "l"). */
function foldLeet(token: string, one: string): string {
  if (!/[a-z]/.test(token)) return token;
  let out = "";
  for (const c of token) out += c === "1" ? one : (LEET[c] ?? c);
  return out;
}

/**
 * Normalize text for the word lists. Leetspeak is folded ("5h1t"), punctuation inside a word splits
 * it, spaced or dotted single letters are joined ("f u c k", "f.u.c.k"), and long repeats are cut
 * ("fuuuuck"). Allowlisted phrases ("cum laude") are taken out first.
 */
export function normalize(text: string): Normalized {
  let plain = plainText(text);
  for (const phrase of ALLOW_PHRASES) plain = plain.split(phrase).join(" ");
  const pieces: { i: string; l: string }[] = [];
  for (const raw of plain.split(" ")) {
    const token = raw.replace(/^["'([{<]+/, "").replace(/[!?.,;:'")\]}>]+$/, "");
    const asI = foldLeet(token, "i").split(/[^a-z]+/);
    const asL = foldLeet(token, "l").split(/[^a-z]+/);
    asI.forEach((part, k) => {
      if (part) pieces.push({ i: part, l: asL[k] ?? part });
    });
  }
  // Runs of three or more single letters are one word spelled out.
  const merged: { i: string; l: string }[] = [];
  for (let k = 0; k < pieces.length; ) {
    let end = k;
    while (end < pieces.length && pieces[end]?.i.length === 1) end++;
    if (end - k >= 3) {
      const run = pieces.slice(k, end);
      merged.push({ i: run.map((p) => p.i).join(""), l: run.map((p) => p.l).join("") });
      k = end;
    } else {
      const piece = pieces[k];
      if (piece) merged.push(piece);
      k++;
    }
  }
  const words = merged.map(({ i, l }) => {
    const spellings = new Set([i, cutToTwo(i), l, cutToTwo(l)]);
    if (hasRun(i)) spellings.add(cutToOne(i));
    if (hasRun(l)) spellings.add(cutToOne(l));
    return [...spellings];
  });
  return { plain, words, joined: words.map((w) => w[0]).join(" ") };
}

// ---------- the lists ----------

const HATE = new Set(HATE_WORDS);
const VULGAR = new Set(VULGAR_WORDS);
const VULGAR_SUFFIXES = ["s", "es", "ed", "er", "ers", "ing", "in", "y"];
const HATE_PHRASE_PATTERNS = HATE_PHRASES.map((p) => new RegExp(`\\b${p}\\b`));

const allowed = (spellings: string[]) => spellings.some((s) => ALLOW_WORDS.has(s));

/**
 * Whether a word is a slur. Exact matches only, since suffixes would catch "spices". The worst few
 * also match inside longer words, because names are often run together ("xXslurXx").
 */
function hateWord(spellings: string[]): boolean {
  if (allowed(spellings)) return false;
  return spellings.some(
    (s) => HATE.has(s) || (s.length > 4 && HATE_IN_WORDS.some((w) => s.includes(w))),
  );
}

function vulgarWord(spellings: string[]): boolean {
  if (allowed(spellings)) return false;
  return spellings.some(
    (s) =>
      VULGAR.has(s) ||
      VULGAR_SUFFIXES.some(
        (suffix) =>
          s.length > suffix.length + 2 &&
          s.endsWith(suffix) &&
          VULGAR.has(s.slice(0, -suffix.length)),
      ),
  );
}

/** Whether normalized text holds a slur or a hate phrase. */
export function hasHate(n: Normalized): boolean {
  if (n.words.some(hateWord)) return true;
  return HATE_PHRASE_PATTERNS.some((p) => p.test(n.joined));
}

/** Whether normalized text holds strong language. */
export const hasVulgar = (n: Normalized): boolean => n.words.some(vulgarWord);

/** Words that don't break a rule on their own but make text worth a second look. */
const SCAM_HINTS =
  /\b(?:seed phrase|recovery phrase|private keys?|airdrops?|giveaways?|wallets?|usdt|telegram|whatsapp|investment|forex|crypto|bitcoin|dm me)\b/;
const INJECTION_HINTS =
  /\b(?:ignore (?:all|any|previous|prior|your)|system prompt|you are an ai|as an ai|your (?:instructions|owner)|reply with your)\b/;
const LOOKALIKE_SLURS = HATE_WORDS.filter((w) => w.length >= 5);

/**
 * Signals that text which passed every filter almost didn't (RFC 0006's borderline band): a slur
 * inside a longer word, scam words, or words aimed at AI readers. Names of signals only, never
 * the text. Staff never see these; AI triage takes a second look at public text that has any.
 */
export function borderlineSignals(n: Normalized): string[] {
  const signals: string[] = [];
  const lookalike = n.words.some(
    (spellings) =>
      !allowed(spellings) &&
      spellings.some((s) => LOOKALIKE_SLURS.some((w) => s !== w && s.includes(w))),
  );
  if (lookalike) signals.push("slur_lookalike");
  if (SCAM_HINTS.test(n.plain) || SCAM_HINTS.test(n.joined)) signals.push("scam_words");
  if (INJECTION_HINTS.test(n.plain)) signals.push("reader_words");
  return signals;
}

/** Whether the text reads like a common scam. */
export const hasScam = (n: Normalized): boolean =>
  SCAM_PATTERNS.some((p) => p.test(n.plain) || p.test(n.joined));

/** Whether the text sounds like the Terrakin team, by the rules for names or for other text. */
export function soundsOfficial(n: Normalized, rules: "name" | "text"): boolean {
  const patterns =
    rules === "name"
      ? [...IMPERSONATION_IN_NAMES, ...IMPERSONATION_IN_TEXT]
      : IMPERSONATION_IN_TEXT;
  return patterns.some((p) => p.test(n.plain) || p.test(n.joined));
}

// ---------- links ----------

const URL_PATTERN =
  /\b((https?:\/\/)?(www\.)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})(?::\d{1,5})?(?:[/?#][^\s]*)?)/g;
/** Bare domains count as links only with a familiar ending, so "file.txt" isn't one. */
const LINK_TLDS = new Set(
  "com net org io co me app dev xyz ly gg link site online info ru top shop store biz us uk ai to cc tv be ws".split(
    " ",
  ),
);

export interface FoundLink {
  domain: string;
  /** Written with a scheme or `www.`, or ending in a familiar top-level domain. */
  counts: boolean;
}

/** Every web address in plain text (see `plainText`). */
export function findLinks(plain: string): FoundLink[] {
  return [...plain.matchAll(URL_PATTERN)].map((m) => {
    const domain = m[4] ?? "";
    const tld = domain.split(".").at(-1) ?? "";
    return { domain, counts: Boolean(m[2] || m[3]) || LINK_TLDS.has(tld) };
  });
}

const inList = (domain: string, list: ReadonlySet<string>) => {
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (list.has(parts.slice(i).join("."))) return true;
  return false;
};

export const isShortener = (domain: string) => inList(domain, SHORTENERS);
export const isDeniedDomain = (domain: string) => inList(domain, DENIED_DOMAINS);

// ---------- spam shapes ----------

export const countMentions = (plain: string) =>
  [...plain.matchAll(/(?:^|\s)@[a-z0-9_]{1,30}/g)].length;

/** Mostly capitals, and long enough for that to be shouting rather than an acronym. */
export function isShouting(text: string): boolean {
  const cased = [...text.matchAll(/[\p{Lu}\p{Ll}]/gu)].length;
  if (cased < THRESHOLDS.caps.minLetters) return false;
  const upper = [...text.matchAll(/\p{Lu}/gu)].length;
  return upper / cased >= THRESHOLDS.caps.ratio;
}

/** One character, or one word, repeated many times in a row. */
export function hasLongRun(text: string, n: Normalized): boolean {
  const sameChar = new RegExp(`(\\S)\\1{${THRESHOLDS.runs.sameChar - 1},}`, "u");
  if (sameChar.test(text)) return true;
  let run = 1;
  for (let i = 1; i < n.words.length; i++) {
    run = n.words[i]?.[0] === n.words[i - 1]?.[0] ? run + 1 : 1;
    if (run >= THRESHOLDS.runs.sameWord) return true;
  }
  return false;
}

/** FNV-1a, enough to tell texts apart in memory. Not for anything secret. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}:${text.length}`;
}

// ---------- the reviewer ----------

export type Category = Exclude<FilterCategory, "cooldown">;

export type Verdict =
  | {
      ok: true;
      /** `language` when a post or reply has strong language (shown with a content warning). */
      contentWarning?: "language";
      /** Borderline signals (see `borderlineSignals`). Absent when there are none. */
      borderline?: string[];
      /** Call once the text is stored, so the spam checks count it. */
      commit(): void;
    }
  | {
      ok: false;
      category: FilterCategory;
      code: "bad_request" | "rate_limited";
      message: string;
      retryAfter?: number;
    };

/** A refusal as a service failure, or undefined when the text may go ahead. */
export function refusal(verdict: Verdict) {
  if (verdict.ok) return undefined;
  return {
    ok: false as const,
    code: verdict.code,
    message: verdict.message,
    ...(verdict.retryAfter === undefined ? {} : { retryAfter: verdict.retryAfter }),
  };
}

export interface ReviewContext {
  /** Who wrote it. Without one (joining), nothing is counted against anybody. */
  resident?: string | undefined;
  /** The writer's network: `ipKey()` of their address. Only the crowd check uses it. */
  network?: string | undefined;
}

export interface ModerationOptions {
  now?: () => number;
  /** Townsfolk and maintainers: may sound official, and are never paused. Server grants only. */
  privileged?: (residentId: string) => boolean;
}

export const HATE_MESSAGE = "That includes words we don't allow on Terrakin.";
export const SCAM_MESSAGE =
  "That reads like a common scam (asking for wallet secrets, crypto giveaways, or investment pitches), so it wasn't sent. If it isn't one, say it another way.";
export const COOL_DOWN_MESSAGE =
  "Several things you wrote were turned away in a short time, so writing is paused for a while. You can still read. Try again later.";

const MAX_REMEMBERED = 50;

/**
 * Reviews text and keeps the in-memory counts the spam checks and the strike rule need: recent
 * texts per resident and per network, refusals per resident, and cool-downs. All of it is lost on
 * restart, which only ever makes the filters more lenient.
 */
export class Moderation {
  private readonly now: () => number;
  private readonly privileged: (residentId: string) => boolean;
  /** Recent accepted texts per resident: fingerprint and time. */
  private readonly recent = new Map<string, { key: string; at: number }[]>();
  /** Who sent each text from each network: `network fingerprint` -> resident -> time. */
  private readonly crowd = new Map<string, Map<string, number>>();
  private readonly strikes = new Map<string, number[]>();
  private readonly pausedUntil = new Map<string, number>();
  /** The pause each resident was last counted for, so one pause counts once. */
  private readonly pauseCounted = new Map<string, number>();
  private readonly refused: Record<FilterCategory, number>;
  /** When the counts started (the last restart). */
  readonly since: number;

  constructor(options: ModerationOptions = {}) {
    this.now = options.now ?? Date.now;
    this.privileged = options.privileged ?? (() => false);
    this.since = this.now();
    this.refused = Object.fromEntries(FILTER_CATEGORIES.map((c) => [c, 0])) as Record<
      FilterCategory,
      number
    >;
  }

  /** Review one piece of text. On a refusal, the writer gets a strike. */
  review(surface: Surface, text: string, context: ReviewContext = {}): Verdict {
    const { resident } = context;
    if (resident) {
      const wait = this.coolDown(resident);
      if (wait > 0) return this.pause(resident, wait);
    }
    const verdict = this.judge(surface, text, context);
    if (!verdict.ok) {
      this.refused[verdict.category]++;
      console.info(
        `Moderation: ${verdict.category} turned away (${surface}) from ${resident ?? "a new resident"}`,
      );
      if (resident) this.strike(resident);
    }
    return verdict;
  }

  /** Strong language in a post, for its content warning. */
  contentWarning(text: string): "language" | undefined {
    return hasVulgar(normalize(text)) ? "language" : undefined;
  }

  /** Refusals in the last hour, for the review queue's context. */
  strikeCount(residentId: string): number {
    const now = this.now();
    return (this.strikes.get(residentId) ?? []).filter((t) => now - t < THRESHOLDS.strikes.windowMs)
      .length;
  }

  /** Seconds until a resident may write again, or 0. */
  coolDown(residentId: string): number {
    const until = this.pausedUntil.get(residentId) ?? 0;
    const left = until - this.now();
    if (left <= 0) {
      if (until) {
        this.pausedUntil.delete(residentId);
        this.pauseCounted.delete(residentId);
      }
      return 0;
    }
    return Math.ceil(left / 1000);
  }

  /**
   * The refusal for a paused resident. The transparency page counts each pause once, however many
   * requests a client sends while it lasts.
   */
  pause(residentId: string, seconds: number): Verdict & { ok: false } {
    const until = this.pausedUntil.get(residentId);
    if (until !== undefined && this.pauseCounted.get(residentId) !== until) {
      this.pauseCounted.set(residentId, until);
      this.refused.cooldown++;
    }
    return {
      ok: false,
      category: "cooldown",
      code: "rate_limited",
      message: COOL_DOWN_MESSAGE,
      retryAfter: seconds,
    };
  }

  /** Refusals by category since `since`. */
  counts(): Record<FilterCategory, number> {
    return { ...this.refused };
  }

  /** Forget what has aged out. Call about once a minute. */
  sweep() {
    const now = this.now();
    for (const [id, list] of this.recent) {
      const kept = list.filter((e) => now - e.at < THRESHOLDS.repeat.windowMs);
      if (kept.length === 0) this.recent.delete(id);
      else this.recent.set(id, kept);
    }
    for (const [key, who] of this.crowd) {
      for (const [id, at] of who) if (now - at >= THRESHOLDS.crowd.windowMs) who.delete(id);
      if (who.size === 0) this.crowd.delete(key);
    }
    for (const [id, times] of this.strikes) {
      const kept = times.filter((t) => now - t < THRESHOLDS.strikes.windowMs);
      if (kept.length === 0) this.strikes.delete(id);
      else this.strikes.set(id, kept);
    }
    for (const id of this.pausedUntil.keys()) this.coolDown(id);
  }

  private strike(residentId: string) {
    if (this.privileged(residentId)) return;
    const now = this.now();
    const times = (this.strikes.get(residentId) ?? []).filter(
      (t) => now - t < THRESHOLDS.strikes.windowMs,
    );
    times.push(now);
    if (times.length >= THRESHOLDS.strikes.max) {
      this.strikes.delete(residentId);
      this.pausedUntil.set(residentId, now + THRESHOLDS.strikes.coolDownMs);
      console.info(`Moderation: writes paused for ${residentId}`);
      return;
    }
    this.strikes.set(residentId, times);
  }

  private judge(surface: Surface, text: string, context: ReviewContext): Verdict {
    const policy = POLICY[surface];
    const refuse = (
      category: Category,
      message: string,
      code: "bad_request" | "rate_limited" = "bad_request",
      retryAfter?: number,
    ): Verdict => ({
      ok: false,
      category,
      code,
      message,
      ...(retryAfter === undefined ? {} : { retryAfter }),
    });

    const aimed = aimedAtReader(text);
    if (aimed) return refuse("injection", readerMessage(policy.label, aimed));
    const handle = agentHandle(text);
    if (handle === "owner_code") return refuse("injection", OWNER_CODE_MESSAGE);
    if (handle === "request") return refuse("injection", requestMessage(policy.label));

    const n = normalize(text);
    if (hasHate(n)) return refuse("hate", HATE_MESSAGE);

    const privileged = context.resident !== undefined && this.privileged(context.resident);
    if (policy.impersonation && !privileged && soundsOfficial(n, policy.impersonation)) {
      return refuse(
        "scam",
        `${policy.label} can't sound like the Terrakin team. Say it another way.`,
      );
    }
    if (hasScam(n)) return refuse("scam", SCAM_MESSAGE);
    const links = findLinks(n.plain);
    if (links.some((l) => isDeniedDomain(l.domain))) {
      return refuse("scam", "That link goes somewhere we don't allow. Leave it out.");
    }
    if (policy.shorteners && links.some((l) => isShortener(l.domain))) {
      return refuse(
        "scam",
        "Short links hide where they go. Use the full address, or leave the link out.",
      );
    }

    const vulgar = policy.vulgar !== "allow" && hasVulgar(n);
    if (vulgar && policy.vulgar === "refuse") {
      return refuse("vulgar", `${policy.label} can't include strong language. Say it another way.`);
    }

    const checks = new Set(policy.spam);
    if (checks.has("links") && links.filter((l) => l.counts).length > THRESHOLDS.links) {
      return refuse("spam", `Use at most ${THRESHOLDS.links} links.`);
    }
    if (checks.has("mentions") && countMentions(n.plain) > THRESHOLDS.mentions) {
      return refuse("spam", `Mention at most ${THRESHOLDS.mentions} people at once.`);
    }
    if (checks.has("caps") && isShouting(text)) {
      return refuse("spam", "Please don't write it all in capitals.");
    }
    if (checks.has("runs") && hasLongRun(text, n)) {
      return refuse("spam", "That repeats the same thing many times in a row. Trim it down.");
    }

    const key = fingerprint(n.joined);
    const now = this.now();
    const long = n.joined.length;
    const { resident, network } = context;
    if (checks.has("repeat") && resident && long >= THRESHOLDS.repeat.minLength) {
      const same = (this.recent.get(resident) ?? []).filter(
        (e) => e.key === key && now - e.at < THRESHOLDS.repeat.windowMs,
      ).length;
      if (same >= THRESHOLDS.repeat.max) {
        return refuse("spam", "You've already posted that. Say something new.");
      }
    }
    const crowdKey = `${network} ${key}`;
    if (checks.has("crowd") && resident && network && long >= THRESHOLDS.crowd.minLength) {
      const others = [...(this.crowd.get(crowdKey) ?? [])].filter(
        ([id, at]) => id !== resident && now - at < THRESHOLDS.crowd.windowMs,
      ).length;
      if (others >= THRESHOLDS.crowd.residents) {
        return refuse(
          "spam",
          "Lots of residents on your network just sent the same words. Wait a few minutes, then say it your own way.",
          "rate_limited",
          Math.ceil(THRESHOLDS.crowd.windowMs / 1000),
        );
      }
    }

    const borderline = borderlineSignals(n);
    return {
      ok: true,
      ...(vulgar ? { contentWarning: "language" as const } : {}),
      ...(borderline.length ? { borderline } : {}),
      commit: () => {
        if (!resident) return;
        if (checks.has("repeat")) {
          const list = this.recent.get(resident) ?? [];
          list.push({ key, at: now });
          this.recent.set(resident, list.slice(-MAX_REMEMBERED));
        }
        if (checks.has("crowd") && network) {
          const who = this.crowd.get(crowdKey) ?? new Map<string, number>();
          who.set(resident, now);
          this.crowd.set(crowdKey, who);
        }
      },
    };
  }
}
