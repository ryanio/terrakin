/**
 * The data behind the edge filters (`moderation.ts`, RFC 0006): word lists, scam patterns, link
 * lists, and thresholds. Tune the filters here; the code reads everything from this file.
 *
 * The slur and profanity lists are stored in ROT13, so reading this file, searching the repo, or
 * scrolling a diff doesn't put the words in front of anyone. It hides nothing from someone who
 * wants to read them (`decode` is one line). Add a word by ROT13-encoding it, for example with
 * `echo word | tr 'A-Za-z' 'N-ZA-Mn-za-m'`.
 *
 * Every list is matched against normalized text (lowercase, NFKC, invisible characters removed,
 * leetspeak folded, spaced-out letters joined) and on whole words, never inside other words,
 * except `HATE_IN_WORDS`. Keep false positives low: a new word needs a test showing ordinary
 * sentences that contain lookalikes still pass.
 */

const rot13 = (s: string) =>
  s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const decode = (list: string[]) => list.map(rot13);

// ---------- hate: refused everywhere ----------

/** Slurs, matched as whole words (plus a plural `s`). */
export const HATE_WORDS: readonly string[] = decode([
  "avttre",
  "avttref",
  "avttn",
  "avttnf",
  "avttnm",
  "avtyrg",
  "pbba",
  "pbbaf",
  "fcvp",
  "fcvpf",
  "fcvpx",
  "jrgonpx",
  "jrgonpxf",
  "ornare",
  "ornaref",
  "puvax",
  "puvaxf",
  "tbbx",
  "tbbxf",
  "xvxr",
  "xvxrf",
  "xlxr",
  "enturnq",
  "enturnqf",
  "gbjryurnq",
  "gbjryurnqf",
  "fnaqavttre",
  "wvtnobb",
  "cbepuzbaxrl",
  "whatyrohaal",
  "mvccreurnq",
  "cnxv",
  "cnxvf",
  "tbyyvjbt",
  "jbt",
  "jbtf",
  "qntb",
  "qntbf",
  "jbc",
  "jbcf",
  "erqfxva",
  "erqfxvaf",
  "fdhnj",
  "tlcb",
  "tlccb",
  "snttbg",
  "snttbgf",
  "snt",
  "sntf",
  "snttl",
  "genaal",
  "genaavrf",
  "furznyr",
  "furznyrf",
  "cbbsgre",
  "cbbsgref",
  "ongglobl",
  "ergneq",
  "ergneqf",
  "ergneqrq",
  "zbatbybvq",
]);

/**
 * The worst slurs, matched inside longer words too, because names are often run together. The
 * allowlist below keeps real words that contain them.
 */
export const HATE_IN_WORDS: readonly string[] = decode(["avttre", "avttn", "snttbg"]);

/** Hate phrases, matched on whole words with spaces collapsed. */
export const HATE_PHRASES: readonly string[] = decode([
  "urvy uvgyre",
  "fvrt urvy",
  "tnf gur wrjf",
  "juvgr cbjre",
  "xvyy nyy wrjf",
  "xvyy nyy oynpxf",
  "xvyy nyy tnlf",
  "xvyy nyy zhfyvzf",
  "xvyy nyy zrkvpnaf",
  "xvyy nyy vzzvtenagf",
  "xvyy nyy genaf",
  "xvyy nyy nfvnaf",
  "xvyy nyy nenof",
  "xvyy nyy puevfgvnaf",
  "xvyy nyy jbzra",
  "qrngu gb wrjf",
  "qrngu gb zhfyvzf",
  "wrjf ner irezva",
  "wrjf ner engf",
]);

// ---------- strong language: refused in names, notes, bios, proposals, and notices; a content
// warning on posts and replies; allowed in letters, chat, and gesture notes ----------

/** Profanity and explicit sexual words, matched as whole words. */
export const VULGAR_WORDS: readonly string[] = decode([
  "shpx",
  "shpxf",
  "shpxrq",
  "shpxre",
  "shpxref",
  "shpxvat",
  "shpxva",
  "shpxurnq",
  "shpxsnpr",
  "shpxjvg",
  "shpxgneq",
  "zbgureshpxre",
  "zbgureshpxref",
  "zbgureshpxvat",
  "fuvg",
  "fuvgf",
  "fuvggl",
  "fuvgurnq",
  "fuvgurnqf",
  "ohyyfuvg",
  "ubefrfuvg",
  "qvcfuvg",
  "fuvggre",
  "phag",
  "phagf",
  "gjng",
  "gjngf",
  "ovgpu",
  "ovgpurf",
  "ovgpul",
  "nffubyr",
  "nffubyrf",
  "nefrubyr",
  "nefrubyrf",
  "nff",
  "nefr",
  "qhzonff",
  "wnpxnff",
  "onfgneq",
  "onfgneqf",
  "qvpxurnq",
  "qvpxurnqf",
  "pbpxfhpxre",
  "pbpxfhpxref",
  "chffl",
  "chffvrf",
  "juber",
  "juberf",
  "fyhg",
  "fyhgf",
  "fyhggl",
  "jnaxre",
  "jnaxref",
  "jnax",
  "obyybpxf",
  "wvmm",
  "phz",
  "phzfubg",
  "oybjwbo",
  "oybjwbof",
  "unaqwbo",
  "qvyqb",
  "qvyqbf",
  "cbea",
  "cbeab",
  "gvggvrf",
  "fxnax",
  "qbhpuront",
]);

// ---------- false-positive guards ----------

/**
 * Words that contain or look like a listed word but aren't one. Whole-word matching already lets
 * most of these through; they are listed so a future change to the matching can't start
 * refusing them.
 */
export const ALLOW_WORDS: ReadonlySet<string> = new Set([
  "scunthorpe",
  "assessment",
  "assessments",
  "classic",
  "classics",
  "cocktail",
  "cocktails",
  "hancock",
  "cumin",
  "cumming",
  "cummings",
  "snigger",
  "sniggers",
  "sniggering",
  "sniggered",
  "niggard",
  "niggardly",
  "assassin",
  "assassins",
  "bass",
  "grass",
  "pass",
  "glass",
  "raccoon",
  "raccoons",
  "cocoon",
  "tycoon",
  "spicy",
  "therapist",
  "pakistan",
  "pakistani",
]);

/** Phrases removed before matching, because a listed word inside them means something else. */
export const ALLOW_PHRASES: readonly string[] = [
  "cum laude",
  "pussy willow",
  "pussy willows",
  "pussy cat",
  "pussycat",
  "spick and span",
  "spic and span",
];

// ---------- scams ----------

/** A crypto ticker or coin name, for the scam patterns. Terrakin's own coins are left out. */
const CRYPTO =
  "(?:crypto|bitcoin|btc|eth|ether|ethereum|usdt|usdc|tether|sol|solana|bnb|xrp|doge|dogecoin)";

/**
 * Scam patterns, matched against the normalized text with spaces collapsed. Each one is narrow on
 * purpose: asking for wallet secrets, "send crypto here", doubling money, crypto giveaways, wallet
 * drainers, and investment pitches into private messages.
 */
export const SCAM_PATTERNS: readonly RegExp[] = [
  // Asking for wallet secrets.
  /\b(?:send|share|give|enter|type|paste|tell|dm|verify|confirm|provide|import|need|submit|input)\b(?: \w+){0,3} (?:seed|recovery|secret|mnemonic|backup|wallet) (?:phrase|words?|key)s?\b/,
  /\b(?:send|share|give|enter|type|paste|tell|dm|verify|confirm|provide|import|need|submit|input)\b(?: \w+){0,3} private keys?\b/,
  /\b(?:12|24|twelve|twenty[ -]?four)[ -]words? (?:seed|recovery|secret|phrase)\b/,
  // Send crypto.
  new RegExp(`\\bsend (?:me |us |it |them )?(?:\\$?\\d[\\d,.]*\\s*k?\\s*)?${CRYPTO}\\b`),
  new RegExp(`\\bsend \\$?\\d[\\d,.]*\\s*k? (?:of )?${CRYPTO}\\b`),
  // Double your money.
  new RegExp(
    `\\b(?:double|triple|2x|3x|5x|10x|100x|multiply) (?:your |ur )?(?:${CRYPTO}|money|investment|funds|deposit)\\b`,
  ),
  /\bguaranteed (?:returns?|profits?|income|payouts?)\b/,
  // Giveaways and airdrops.
  new RegExp(`\\b(?:${CRYPTO}|nft|token|airdrop) giveaway\\b`),
  new RegExp(`\\bfree (?:${CRYPTO}|nfts?|airdrops?|tokens)\\b`),
  /\bclaim (?:your |ur )?(?:free )?(?:airdrop|tokens|nfts?|crypto)\b/,
  // Wallet drainers.
  /\b(?:connect|link|sync|validate|verify|restore|rectify) (?:your |ur )?(?:crypto |web3 |metamask |trust )?wallets?\b/,
  /\bwallet (?:validation|verification|sync|rectification)\b/,
  // Investment pitches into private messages.
  /\b(?:dm|message|inbox|text|whatsapp|telegram|contact) me (?:for|about|on) (?:investment|investing|trading|profits?|signals|crypto|forex|returns|whatsapp|telegram)\b/,
  /\b(?:forex|crypto|binary options?|bitcoin) (?:trading )?(?:signals|mentor|account manager|expert)\b/,
  /\binvest (?:with|through) me\b/,
];

/**
 * Sounding like the Terrakin team. Names are held to the stricter list; notes and bios only to the
 * phrases. The townsfolk and maintainers (server grants) are exempt.
 */
export const IMPERSONATION_IN_NAMES: readonly RegExp[] = [
  /\bterrakin\b/,
  /\b(?:admin|admins|administrator|moderator|moderators|sysadmin|helpdesk|help desk)\b/,
  /\b(?:customer|official|tech) support\b/,
  /\bsupport team\b/,
  /\bofficial\b/,
];
export const IMPERSONATION_IN_TEXT: readonly RegExp[] = [
  /\bterrakin (?:team|staff|support|admin|admins|moderator|moderators|official|security|help ?desk)\b/,
  /\bofficial (?:terrakin|support|staff|team|account|moderator)\b/,
  /\b(?:i am|i'm|im|we are|we're|this is) (?:an? |the )?(?:terrakin )?(?:admin|administrator|moderator|staff member)\b/,
  /\b(?:customer|tech) support\b/,
];

// ---------- links ----------

/** Link shorteners hide where a link goes. Refused in names, notes, and bios. */
export const SHORTENERS: ReadonlySet<string> = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "v.gd",
  "buff.ly",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
  "rb.gy",
  "t.ly",
  "tiny.cc",
  "bl.ink",
  "s.id",
  "lnkd.in",
  "shorte.st",
  "adf.ly",
  "tiny.one",
]);

/**
 * Domains refused anywhere. IP loggers first: opening one tells its owner the reader's address,
 * which is how doxxing starts.
 */
export const DENIED_DOMAINS: ReadonlySet<string> = new Set([
  "grabify.link",
  "iplogger.org",
  "iplogger.com",
  "iplogger.ru",
  "2no.co",
  "yip.su",
  "blasze.com",
  "ps3cfw.com",
  "ipgrabber.ru",
  "lovebird.guru",
  "trulove.guru",
  "dateing.club",
]);

// ---------- thresholds ----------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const THRESHOLDS = {
  /** Refusals in `windowMs` that pause a resident's writes for `coolDownMs`. */
  strikes: { max: 5, windowMs: HOUR, coolDownMs: HOUR },
  /** The same text from one resident: `max` times in `windowMs`. Short texts ("thanks!") are free. */
  repeat: { max: 2, windowMs: 24 * HOUR, minLength: 16 },
  /** The same text from `residents` other residents on one network within `windowMs`. */
  crowd: { residents: 3, windowMs: 10 * MINUTE, minLength: 16 },
  /** Most links in one post, reply, or notice. */
  links: 3,
  /**
   * Most @mentions in one post, reply, or notice. Only the first 10 are linked and notified
   * (`MAX_MENTIONS_PER_POST`); past twice that, it's a flood.
   */
  mentions: 20,
  /** All capitals: at least `minLetters` letters and `ratio` of them capitals. */
  caps: { minLetters: 60, ratio: 0.9 },
  /** One character, or one word, repeated this many times in a row. */
  runs: { sameChar: 16, sameWord: 8 },
} as const;
