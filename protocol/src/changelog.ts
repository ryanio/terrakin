import { z } from "zod";
import { absolute, LINKS, SITE } from "./site";

/**
 * The agent changelog: CHANGELOG.md at the repo root, parsed into typed entries. `pnpm gen` turns
 * it into the /changelog page and its Markdown twin, the Atom feed, and the data behind
 * `GET /v1/changelog`, and keeps the API fingerprint in its newest day current (decision 0036).
 * Pure functions, browser-safe: the caller reads the file and hashes the API.
 *
 * The format, line by line:
 *
 *   # Changelog                      anything before the first day is the preamble
 *   ## 2026-10-04                    a day, newest first
 *   <!-- api-fingerprint: 0123456789ab, 3 entries -->   written by `pnpm gen`
 *   - **Added** One-line title       Added, Changed, Deprecated, Removed, Fixed, or Security
 *     1 to 3 lines, indented two spaces, for an AI reader
 */

export const CHANGELOG_KINDS = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
] as const;
export type ChangelogKindName = (typeof CHANGELOG_KINDS)[number];

export const ChangelogKind = z
  .enum(["added", "changed", "deprecated", "removed", "fixed", "security"])
  .describe(
    "`added` new routes, fields, or actions to try; `changed` behavior you'd notice; `deprecated` still works, move off it before its removal date; `removed` gone; `fixed` a bug fix; `security` a safety or security change.",
  );
export type ChangelogKind = z.infer<typeof ChangelogKind>;

export const ChangelogEntry = z.object({
  id: z
    .string()
    .describe(
      "Stable id: the day plus the title as a slug, like `2026-10-04-a-changelog-for-agents`.",
    ),
  date: z.string().describe("The day it shipped, `YYYY-MM-DD` (UTC)."),
  kind: ChangelogKind,
  title: z.string().describe("One line."),
  body: z
    .string()
    .describe(
      "One to three short lines of Markdown: what it is, how to use it, and for a deprecation what to move to.",
    ),
  links: z.array(z.string()).describe("Absolute URLs the entry links to, in order."),
  removal: z
    .string()
    .optional()
    .describe("Deprecations only: the earliest day it may be removed, `YYYY-MM-DD`."),
});
export type ChangelogEntry = z.infer<typeof ChangelogEntry>;

export const ChangelogResponse = z.object({
  entries: z.array(ChangelogEntry).describe("Newest day first; within a day, in file order."),
  latest: z
    .string()
    .describe(
      "The newest day in the whole changelog, `YYYY-MM-DD`. Keep it and send it as `since` next time.",
    ),
});
export type ChangelogResponse = z.infer<typeof ChangelogResponse>;

/** What `pnpm gen` recorded about the API when the newest day was last stamped. */
export interface ApiFingerprint {
  /** 12 hex characters of SHA-256 over protocol/openapi.json and SKILL.md's API block. */
  hash: string;
  /** How many entries the day had then. Stamping a new hash needs more than this. */
  entries: number;
}

export interface ChangelogDay {
  date: string;
  fingerprint?: ApiFingerprint;
  entries: ChangelogEntry[];
}

export interface Changelog {
  /** Everything before the first day, trimmed. */
  preamble: string;
  /** Newest first. */
  days: ChangelogDay[];
}

/** A line of CHANGELOG.md that breaks the format. The message names the line and the fix. */
export class ChangelogError extends Error {
  override name = "ChangelogError";
}

export const API_CHANGED_MESSAGE =
  "The API changed since the last changelog entry. Add an entry to CHANGELOG.md and run pnpm gen.";

const TITLE_MAX = 100;
const LINE_MAX = 320;
const BODY_LINES = 3;
const SLUG_MAX = 60;

const DAY = /^## (.*)$/;
const ENTRY = /^- \*\*([A-Za-z]+)\*\* (.+)$/;
const BODY = /^ {2}(\S.*)$/;
const FINGERPRINT = /^<!-- api-fingerprint: ([0-9a-f]{12}), (\d+) entr(?:y|ies) -->$/;
const REMOVAL = /Earliest removal: (\d{4}-\d{2}-\d{2})/;

/** `2026-10-04` if it is a real day in that form. */
function isDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The title as an id-safe slug: lowercase letters and digits joined by single dashes. */
export function changelogSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, "");
}

/** Markdown link targets and bare URLs in `text`, made absolute, in order, without repeats. */
function linksIn(text: string): string[] {
  const found: string[] = [];
  const withoutLinks = text.replace(/\[[^\]]*\]\(([^)\s]+)\)/g, (_, href: string) => {
    found.push(href);
    return " ";
  });
  // Code spans hold examples, not links.
  const prose = withoutLinks.replace(/`[^`]*`/g, " ");
  for (const m of prose.matchAll(/\bhttps?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]/g)) found.push(m[0]);
  const absoluteUrl = (href: string) => (href.startsWith("/") ? absolute(href) : href);
  return [...new Set(found.filter((h) => /^(https?:\/\/|\/)/.test(h)).map(absoluteUrl))];
}

const kindOf = (tag: string): ChangelogKind | undefined =>
  (CHANGELOG_KINDS as readonly string[]).includes(tag)
    ? (tag.toLowerCase() as ChangelogKind)
    : undefined;

/**
 * Parse CHANGELOG.md. Throws a `ChangelogError` naming the first line that breaks the format,
 * so `pnpm gen` and the tests can say exactly what to fix.
 */
export function parseChangelog(text: string, file = "CHANGELOG.md"): Changelog {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const fail = (at: number, problem: string): never => {
    throw new ChangelogError(`${file} line ${at + 1}: ${problem}`);
  };

  const preamble: string[] = [];
  const days: ChangelogDay[] = [];
  const ids = new Set<string>();
  let day: ChangelogDay | undefined;
  let entry:
    | { at: number; date: string; kind: ChangelogKind; title: string; body: string[] }
    | undefined;

  const finishEntry = () => {
    if (!entry || !day) return;
    const { at, date, kind, title, body } = entry;
    entry = undefined;
    if (body.length === 0) {
      fail(at, `"${title}" needs 1 to ${BODY_LINES} lines under it, indented two spaces.`);
    }
    const id = `${date}-${changelogSlug(title)}`;
    if (ids.has(id)) fail(at, `two entries on ${date} have the id ${id}. Give one another title.`);
    ids.add(id);
    const joined = body.join("\n");
    const removal = REMOVAL.exec(joined)?.[1];
    if (kind === "deprecated") {
      if (!removal || !isDay(removal)) {
        fail(
          at,
          `a Deprecated entry names what to use instead and its earliest removal date, as "Earliest removal: YYYY-MM-DD".`,
        );
      }
      if (removal && removal <= date)
        fail(at, `the removal date ${removal} must come after ${date}.`);
    }
    day.entries.push({
      id,
      date,
      kind,
      title,
      body: joined,
      links: linksIn(`${title}\n${joined}`),
      ...(kind === "deprecated" && removal ? { removal } : {}),
    });
  };
  const finishDay = (at: number) => {
    finishEntry();
    if (day && day.entries.length === 0) fail(at, `${day.date} has no entries.`);
  };

  lines.forEach((line, at) => {
    const heading = DAY.exec(line);
    if (heading) {
      finishDay(at);
      const date = heading[1]?.trim() ?? "";
      if (!isDay(date)) fail(at, `a day heading is "## YYYY-MM-DD", got "${line}".`);
      const newer = days.at(-1);
      if (newer && date >= newer.date) {
        fail(at, `days go newest first, each once: ${date} can't come after ${newer.date}.`);
      }
      day = { date, entries: [] };
      days.push(day);
      return;
    }
    if (!day) {
      preamble.push(line);
      return;
    }
    if (/[–—]/.test(line)) {
      fail(at, "no em or en dashes. Use a comma, colon, period, or parentheses.");
    }
    if (line.trim() === "") {
      finishEntry();
      return;
    }
    const stamp = FINGERPRINT.exec(line);
    if (stamp) {
      if (day.fingerprint || day.entries.length > 0 || entry) {
        fail(at, "the api-fingerprint comment goes once, right under the day heading.");
      }
      day.fingerprint = { hash: stamp[1] ?? "", entries: Number(stamp[2]) };
      return;
    }
    const item = ENTRY.exec(line);
    if (item) {
      finishEntry();
      const tag = item[1] ?? "";
      const kind = kindOf(tag);
      if (!kind) fail(at, `unknown kind **${tag}**. Use one of ${CHANGELOG_KINDS.join(", ")}.`);
      const title = (item[2] ?? "").trim();
      if (title.length > TITLE_MAX)
        fail(at, `titles are one line of at most ${TITLE_MAX} characters.`);
      entry = { at, date: day.date, kind: kind as ChangelogKind, title, body: [] };
      return;
    }
    const body = BODY.exec(line);
    if (body && entry) {
      if (entry.body.length === BODY_LINES) {
        fail(at, `"${entry.title}" has more than ${BODY_LINES} lines. Say it shorter.`);
      }
      const text = (body[1] ?? "").trimEnd();
      if (text.length > LINE_MAX) fail(at, `lines are at most ${LINE_MAX} characters.`);
      entry.body.push(text);
      return;
    }
    fail(
      at,
      `expected an entry ("- **Added** One-line title"), a line under it indented two spaces, or a blank line. Got "${line.slice(0, 80)}".`,
    );
  });
  finishDay(lines.length - 1);
  if (days.length === 0) throw new ChangelogError(`${file} has no days. Add "## YYYY-MM-DD".`);
  return { preamble: preamble.join("\n").trim(), days };
}

/** Every entry, newest day first. */
export const changelogEntries = (log: Changelog): ChangelogEntry[] =>
  log.days.flatMap((d) => d.entries);

/** The fingerprint comment for a day. */
export const fingerprintComment = ({ hash, entries }: ApiFingerprint) =>
  `<!-- api-fingerprint: ${hash}, ${entries} ${entries === 1 ? "entry" : "entries"} -->`;

/**
 * CHANGELOG.md with the newest day stamped with the current API fingerprint. Unchanged when the
 * stamp already matches. Throws `API_CHANGED_MESSAGE` when the API changed but the newest day has
 * no entries beyond those it had when it was last stamped, so the only way past is a new entry.
 */
export function stampFingerprint(text: string, hash: string): string {
  const log = parseChangelog(text);
  const newest = log.days[0];
  if (!newest) return text;
  const recorded = newest.fingerprint;
  const count = newest.entries.length;
  if (recorded?.hash === hash && recorded.entries === count) return text;
  if (recorded && recorded.hash !== hash && count <= recorded.entries) {
    throw new ChangelogError(API_CHANGED_MESSAGE);
  }
  const comment = fingerprintComment({ hash, entries: count });
  const lines = text.split("\n");
  const heading = lines.findIndex((line) => line.trim() === `## ${newest.date}`);
  let at = heading + 1;
  while (at < lines.length && lines[at]?.trim() === "") at++;
  if (recorded && FINGERPRINT.test(lines[at] ?? "")) lines[at] = comment;
  else lines.splice(heading + 1, 0, "", comment);
  return lines.join("\n");
}

/** Whether the newest day's recorded fingerprint differs from `hash`. */
export function apiChangedSinceStamp(text: string, hash: string): boolean {
  return parseChangelog(text).days[0]?.fingerprint?.hash !== hash;
}

/** The API's answer: entries on or after `since`, of one `kind` if given. */
export function changelogResponse(
  entries: readonly ChangelogEntry[],
  filter: { since?: string | undefined; kind?: ChangelogKind | undefined },
): ChangelogResponse {
  const latest = entries.reduce((max, e) => (e.date > max ? e.date : max), "");
  return {
    entries: entries.filter(
      (e) =>
        (filter.since === undefined || e.date >= filter.since) &&
        (filter.kind === undefined || e.kind === filter.kind),
    ),
    latest,
  };
}

const kindName = (kind: ChangelogKind) =>
  CHANGELOG_KINDS.find((k) => k.toLowerCase() === kind) ?? kind;

const GENERATED_NOTICE =
  "<!-- Generated from CHANGELOG.md by `pnpm gen`. Edit CHANGELOG.md, not this file. -->";

/** How agents can follow along, shared by the page and the docs guide. */
export const CHANGELOG_HOW_TO_FOLLOW = `Agents: \`GET /v1/changelog?since=<your last check>\` returns the same entries as JSON, with \`latest\` to send as \`since\` next time, and \`kind=deprecated\` lists only what to move off. The Atom feed is ${absolute(LINKS.changelogFeed)} and this page is also Markdown at ${absolute(LINKS.changelogMarkdown)}.`;

/** docs/site/changelog.md: the /changelog page (and the body of its Markdown twin). */
export function changelogPage(log: Changelog): string {
  const lines = [
    GENERATED_NOTICE,
    "",
    `# What's new in ${SITE.name}`,
    "",
    "What changed that an AI agent, or the person who runs one, would notice: new things to try, changes in behavior, deprecations to move off before their removal date, and security fixes. Newest first, dates in UTC.",
    "",
    CHANGELOG_HOW_TO_FOLLOW,
  ];
  for (const day of log.days) {
    lines.push("", `## ${day.date}`);
    for (const e of day.entries) {
      lines.push("", `### ${kindName(e.kind)}: ${e.title}`, "", e.body.split("\n").join(" "));
    }
  }
  lines.push(
    "",
    `The source is [CHANGELOG.md](${SITE.github}/blob/main/CHANGELOG.md) on GitHub.`,
    "",
  );
  return lines.join("\n");
}

const xml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A stable Atom id for an entry (RFC 4151 tag URI). */
export const atomEntryId = (id: string) => `tag:terrakin.org,2026-10-02:changelog/${id}`;

/** /changelog.xml: an Atom feed (RFC 4287) with one entry per changelog item. */
export function changelogAtom(log: Changelog): string {
  const entries = changelogEntries(log);
  const stamp = (date: string) => `${date}T00:00:00Z`;
  const page = absolute(LINKS.changelog);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xml(SITE.name)} changelog</title>`,
    "  <subtitle>New features to try, behavior changes, deprecations, and security fixes, for AI agents and the people who run them.</subtitle>",
    `  <id>${page}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${absolute(LINKS.changelogFeed)}"/>`,
    `  <link rel="alternate" type="text/html" href="${page}"/>`,
    `  <link rel="alternate" type="text/markdown" href="${absolute(LINKS.changelogMarkdown)}"/>`,
    `  <updated>${stamp(log.days[0]?.date ?? "2026-10-02")}</updated>`,
    `  <author><name>${xml(SITE.name)}</name><uri>${SITE.github}</uri></author>`,
    `  <icon>${absolute("/favicon.svg")}</icon>`,
    ...entries.flatMap((e) => [
      "  <entry>",
      `    <id>${atomEntryId(e.id)}</id>`,
      `    <title>${xml(`${kindName(e.kind)}: ${e.title}`)}</title>`,
      `    <updated>${stamp(e.date)}</updated>`,
      `    <link rel="alternate" type="text/html" href="${page}#${e.date}"/>`,
      `    <category term="${e.kind}" label="${kindName(e.kind)}"/>`,
      `    <summary type="text">${xml(e.body)}</summary>`,
      "  </entry>",
    ]),
    "</feed>",
    "",
  ].join("\n");
}

/** protocol/src/changelog.generated.ts: the entries, embedded so the Worker needs no file I/O. */
export function changelogModule(log: Changelog): string {
  return [
    "// Generated from CHANGELOG.md by `pnpm gen`. Edit CHANGELOG.md, not this file.",
    'import type { ChangelogEntry } from "./changelog";',
    "",
    `export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = ${JSON.stringify(changelogEntries(log), null, 2)};`,
    "",
  ].join("\n");
}

/** The newest day's entries as a short list, for the "What's new" guide on /docs. */
export function latestChangelogLines(log: Changelog): string[] {
  const newest = log.days[0];
  if (!newest) return [];
  return [
    `Latest, ${newest.date}:`,
    "",
    ...newest.entries.map((e) => `- ${kindName(e.kind)}: ${e.title}`),
  ];
}
