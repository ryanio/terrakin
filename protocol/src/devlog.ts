import { z } from "zod";
import { isDay } from "./changelog";
import { escapeXml } from "./discovery";
import { absolute, LINKS, SITE, type SitePage } from "./site";

/**
 * The devlog: notes for people about what changed in Terrakin and why it's fun, one Markdown file
 * a day in docs/devlog (`YYYY-MM-DD.md`), written by maintainers and never edited once published.
 * `pnpm gen` reads them into the /devlog page, its Atom feed, and `devlog.generated.ts`: the data
 * behind `GET /v1/devlog`, the check-in's `devlog`, and the page each post gets from the client
 * build (decision 0105). Pure functions, browser-safe: the caller reads the files.
 *
 * A post, line by line:
 *
 *   # Devlog 2026-10-06: Autumn in Terrakin    the title; a leading "Devlog <day>:" is dropped
 *   The first paragraph.                       the summary, and the lead on the home wall's card
 *   ## Headings, lists, more paragraphs        the rest, in Markdown
 */

/** The longest summary, in characters. Longer first paragraphs are cut at a sentence or a word. */
export const DEVLOG_SUMMARY_MAX = 280;

export const DevlogEntry = z.object({
  date: z
    .string()
    .describe("The day of the post, `YYYY-MM-DD` (UTC). There's one post a day at most."),
  title: z.string().describe("The post's title."),
  summary: z
    .string()
    .describe(
      `The post's first paragraph as plain text, cut to at most ${DEVLOG_SUMMARY_MAX} characters.`,
    ),
  url: z.string().describe("The post's page on terrakin.org. Add `.md` for its Markdown."),
});
export type DevlogEntry = z.infer<typeof DevlogEntry>;

export const DevlogPost = DevlogEntry.extend({
  body: z
    .string()
    .describe(
      "The whole post after its title, in Markdown. Written by the Terrakin team; links into the repo point at GitHub.",
    ),
});
export type DevlogPost = z.infer<typeof DevlogPost>;

export const DevlogResponse = z.object({
  posts: z.array(DevlogEntry).describe("Newest first."),
  latest: z
    .string()
    .describe("The newest post's day, `YYYY-MM-DD`. Keep it and send it as `since` next time."),
});
export type DevlogResponse = z.infer<typeof DevlogResponse>;

export const DevlogPostResponse = z.object({ post: DevlogPost });
export type DevlogPostResponse = z.infer<typeof DevlogPostResponse>;

/** A post file that breaks the format. The message names the file and the fix. */
export class DevlogError extends Error {
  override name = "DevlogError";
}

/** A post's file name: its day, then `.md`. */
const DEVLOG_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/** Where a post lives on the site, like `/devlog/2026-10-06`. */
export const devlogPath = (date: string): `/${string}` => `${LINKS.devlog}/${date}`;

/** A day for people: `2026-10-06` as "October 6, 2026". */
export function devlogDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
    Date.parse(`${date}T00:00:00Z`),
  );
}

/** Where a block of Markdown starts that isn't a paragraph: a heading, fence, list, table, or comment. */
const BLOCK_START = /^(#{1,6}\s|`{3,}|~{3,}|\s*([-*]|\d+\.)\s|\||<!--)/;

/**
 * A post's body split into its first paragraph and the rest, both Markdown. The card on the home
 * wall shows the lead and folds the rest behind "Show more"; the summary is the lead as plain text.
 */
export function devlogLead(body: string): { lead: string; rest: string } {
  const lines = body.split("\n");
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^(`{3,}|~{3,})/.test(line)) fenced = !fenced;
    if (fenced || line.trim() === "" || BLOCK_START.test(line)) continue;
    let end = i;
    while (
      end < lines.length &&
      (lines[end] ?? "").trim() !== "" &&
      !BLOCK_START.test(lines[end] ?? "")
    ) {
      end++;
    }
    const rest = [...lines.slice(0, i), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
    return { lead: lines.slice(i, end).join("\n"), rest: rest.trim() };
  }
  return { lead: "", rest: body.trim() };
}

/** Markdown as plain text: code spans, links, bold, and italics give up their marks. */
function plainText(markdown: string): string {
  return markdown
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text cut to `max` characters: at the last sentence that fits, else at a word, with "…". */
function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= max / 2) return head.slice(0, sentence + 1);
  const word = head.slice(0, max - 1).lastIndexOf(" ");
  return `${head.slice(0, word > 0 ? word : max - 1).replace(/[\s,;:]+$/, "")}…`;
}

/** Repo-relative links in a post (`../plans/README.md`) made into links to the file on GitHub. */
function linksToRepo(body: string): string {
  return body.replace(/\]\(([^)\s]+)\)/g, (whole, href: string) => {
    if (/^([a-z]+:|\/|#)/i.test(href)) return whole;
    const [path = "", hash] = href.split("#");
    const parts = ["docs", "devlog"];
    for (const piece of path.split("/")) {
      if (piece === "..") parts.pop();
      else if (piece !== "." && piece !== "") parts.push(piece);
    }
    return `](${SITE.github}/blob/main/${parts.join("/")}${hash === undefined ? "" : `#${hash}`})`;
  });
}

/** The title from a post's heading: "Devlog 2026-10-06: Autumn in Terrakin" is "Autumn in Terrakin". */
function titleOf(heading: string, date: string): string {
  const rest = heading
    .trim()
    .replace(new RegExp(`^Devlog\\s+${date}\\s*:?\\s*`, "i"), "")
    .trim();
  if (rest === "") return `Devlog ${date}`;
  return `${rest[0]?.toUpperCase() ?? ""}${rest.slice(1)}`;
}

/**
 * One post from its file. Throws a `DevlogError` naming the file and what to fix, so `pnpm gen`
 * can say it.
 */
function parseDevlogPost(file: string, text: string): DevlogPost {
  const fail = (problem: string): never => {
    throw new DevlogError(`${file}: ${problem}`);
  };
  const date = DEVLOG_FILE.exec(file.split("/").pop() ?? "")?.[1];
  if (!date || !isDay(date)) return fail("a post is named for its day, like 2026-10-06.md.");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const dash = lines.findIndex((line) => /[–—]/.test(line));
  if (dash >= 0) {
    fail(`line ${dash + 1} has an em or en dash. Use a comma, colon, period, or parentheses.`);
  }
  const first = lines.findIndex((line) => line.trim() !== "");
  const heading = /^# (.+)$/.exec(lines[first] ?? "")?.[1];
  if (!heading) return fail(`the first line is its title, like "# Devlog ${date}: What happened".`);
  const body = linksToRepo(
    lines
      .slice(first + 1)
      .join("\n")
      .trim(),
  );
  const { lead } = devlogLead(body);
  if (lead === "") fail("a post needs a paragraph under its title.");
  return {
    date,
    title: titleOf(heading, date),
    summary: cutText(plainText(lead), DEVLOG_SUMMARY_MAX),
    url: absolute(devlogPath(date)),
    body,
  };
}

/** Every post from `docs/devlog`, newest first. Files that aren't named for a day are skipped. */
export function parseDevlog(files: readonly { file: string; text: string }[]): DevlogPost[] {
  return files
    .filter(({ file }) => DEVLOG_FILE.test(file.split("/").pop() ?? ""))
    .map(({ file, text }) => parseDevlogPost(file, text))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** A post without its body, as the list and the check-in show it. */
export const devlogEntry = ({ date, title, summary, url }: DevlogEntry): DevlogEntry => ({
  date,
  title,
  summary,
  url,
});

/** The API's answer: posts from `since` on (inclusive), newest first, without their bodies. */
export function devlogResponse(
  posts: readonly DevlogPost[],
  filter: { since?: string | undefined },
): DevlogResponse {
  return {
    posts: posts
      .filter((p) => filter.since === undefined || p.date >= filter.since)
      .map(devlogEntry),
    latest: posts[0]?.date ?? "",
  };
}

const GENERATED_NOTICE =
  "<!-- Generated from docs/devlog by `pnpm gen`. Write a new post there, not here. -->";

/** How to follow along, on the /devlog page. */
const DEVLOG_HOW_TO_FOLLOW = `Follow along with the Atom feed at ${absolute(LINKS.devlogFeed)}. Agents: \`GET ${LINKS.devlogApi}\` lists the same posts, and the check-in names a new one as \`devlog\`. What changed in the API is in the [changelog](${LINKS.changelog}).`;

/** docs/site/devlog.md: the /devlog page (and the body of its Markdown twin), newest first. */
export function devlogPage(posts: readonly DevlogPost[]): string {
  const lines = [
    GENERATED_NOTICE,
    "",
    `# The ${SITE.name} devlog`,
    "",
    `What's new in ${SITE.name} and why it's fun, for the people who live here and the people whose AIs do. A post on the days something worth telling happens, newest first.`,
    "",
    DEVLOG_HOW_TO_FOLLOW,
  ];
  for (const post of posts) {
    lines.push(
      "",
      `## ${post.title}`,
      "",
      `*${devlogDay(post.date)}*`,
      "",
      post.summary,
      "",
      `[Read the post](${devlogPath(post.date)})`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** A post's own page in Markdown: the title, its day, the post, and a way back to the rest. */
export function devlogPostMarkdown(post: DevlogPost): string {
  return [
    `# ${post.title}`,
    "",
    `*${devlogDay(post.date)}*`,
    "",
    post.body,
    "",
    `[Every devlog post](${LINKS.devlog})`,
    "",
  ].join("\n");
}

/** A post's page, for the build that renders it and the sitemap. */
export function devlogSitePage(post: DevlogEntry): SitePage {
  const path = devlogPath(post.date);
  return {
    path,
    title: `${post.title} · ${SITE.name} devlog`,
    description: post.summary,
    kind: "static",
    sources: [`docs/devlog/${post.date}.md`],
    markdown: `${path}.md`,
  };
}

/** A stable Atom id for a post (RFC 4151 tag URI). */
const devlogAtomId = (date: string) => `tag:terrakin.org,2026-10-02:devlog/${date}`;

/** /devlog.xml: an Atom feed (RFC 4287) with one entry per post. */
export function devlogAtom(posts: readonly DevlogPost[]): string {
  const stamp = (date: string) => `${date}T00:00:00Z`;
  const page = absolute(LINKS.devlog);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escapeXml(SITE.name)} devlog</title>`,
    "  <subtitle>What's new in Terrakin and why it's fun, for the people who live here.</subtitle>",
    `  <id>${page}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${absolute(LINKS.devlogFeed)}"/>`,
    `  <link rel="alternate" type="text/html" href="${page}"/>`,
    `  <updated>${stamp(posts[0]?.date ?? "2026-10-02")}</updated>`,
    `  <author><name>${escapeXml(SITE.name)}</name><uri>${SITE.github}</uri></author>`,
    `  <icon>${absolute("/favicon.svg")}</icon>`,
    ...posts.flatMap((p) => [
      "  <entry>",
      `    <id>${devlogAtomId(p.date)}</id>`,
      `    <title>${escapeXml(p.title)}</title>`,
      `    <updated>${stamp(p.date)}</updated>`,
      `    <link rel="alternate" type="text/html" href="${p.url}"/>`,
      `    <link rel="alternate" type="text/markdown" href="${p.url}.md"/>`,
      `    <summary type="text">${escapeXml(p.summary)}</summary>`,
      "  </entry>",
    ]),
    "</feed>",
    "",
  ].join("\n");
}

/** protocol/src/devlog.generated.ts: every post, embedded so the Worker needs no file I/O. */
export function devlogModule(posts: readonly DevlogPost[]): string {
  return [
    "// Generated from docs/devlog by `pnpm gen`. Write a new post there, not here.",
    'import type { DevlogPost } from "./devlog";',
    "",
    `export const DEVLOG_POSTS: readonly DevlogPost[] = ${JSON.stringify(posts, null, 2)};`,
    "",
  ].join("\n");
}
