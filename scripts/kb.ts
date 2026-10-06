/**
 * Knowledge base tool. Run with `pnpm kb <command>`.
 *
 *   pnpm kb                         rebuild docs/knowledge/INDEX.md
 *   pnpm kb --check                 fail if INDEX.md is stale, an entry is malformed, or two
 *                                   decisions or RFCs share a number (CI runs this)
 *   pnpm kb new decision "Title"    create a decision record, numbered past origin/main's newest
 *   pnpm kb new learning "Title"    create a dated learning note
 *   pnpm kb new handoff "Title"     create a dated session handoff
 *
 * Plain Node (type stripping), no dependencies, so any agent can run it right after cloning.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KB = join(ROOT, "docs", "knowledge");
const INDEX = join(KB, "INDEX.md");

/**
 * Folders whose files start with a four-digit number, and the numbers two files already share.
 * Those stay, since prose cites them by number; any other shared number fails the check.
 */
const NUMBERED = [
  { dir: join(KB, "decisions"), shared: ["0052"] },
  { dir: join(ROOT, "docs", "rfcs"), shared: ["0004"] },
];

const KINDS = {
  decision: {
    dir: "decisions",
    heading: "Decisions",
    blurb: "What we chose and why. Newest last.",
  },
  learning: {
    dir: "learnings",
    heading: "Learnings",
    blurb: "Gotchas, surprises, and things we'd tell our past selves.",
  },
  handoff: {
    dir: "handoffs",
    heading: "Handoffs",
    blurb: "End-of-session notes. Read the latest one before starting work.",
  },
} as const;
type Kind = keyof typeof KINDS;

const DECISION_STATUSES = ["proposed", "accepted", "superseded", "rejected"];

interface Entry {
  kind: Kind;
  file: string;
  title: string;
  date: string;
  status?: string;
  tags: string[];
}

function parseFrontmatter(text: string): Record<string, string> | undefined {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
  if (!match?.[1]) return undefined;
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0)
      fields[line.slice(0, i).trim()] = line
        .slice(i + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1");
  }
  return fields;
}

function load(): { entries: Entry[]; problems: string[] } {
  const entries: Entry[] = [];
  const problems: string[] = [];
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const dir = join(KB, KINDS[kind].dir);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".md") || name === "TEMPLATE.md") continue;
      const file = join(dir, name);
      const rel = relative(ROOT, file);
      const fm = parseFrontmatter(readFileSync(file, "utf8"));
      if (!fm) {
        problems.push(`${rel}: missing frontmatter (--- title/date/tags ---)`);
        continue;
      }
      if (!fm.title) problems.push(`${rel}: missing title`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date ?? ""))
        problems.push(`${rel}: date must be YYYY-MM-DD`);
      if (kind === "decision" && !DECISION_STATUSES.includes(fm.status ?? "")) {
        problems.push(`${rel}: status must be one of ${DECISION_STATUSES.join(", ")}`);
      }
      const tags = (fm.tags ?? "")
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      entries.push({
        kind,
        file: relative(KB, file),
        title: fm.title ?? name,
        date: fm.date ?? "",
        ...(fm.status ? { status: fm.status } : {}),
        tags,
      });
    }
  }
  return { entries, problems: [...problems, ...numberClashes()] };
}

function numberClashes(): string[] {
  const problems: string[] = [];
  for (const { dir, shared } of NUMBERED) {
    const byNumber = new Map<string, string[]>();
    for (const name of readdirSync(dir)) {
      const number = /^(\d{4})-/.exec(name)?.[1];
      if (number) byNumber.set(number, [...(byNumber.get(number) ?? []), name]);
    }
    for (const [number, names] of byNumber) {
      if (names.length > 1 && !shared.includes(number)) {
        problems.push(
          `${relative(ROOT, dir)}: ${names.join(" and ")} share ${number}; renumber the newer one`,
        );
      }
    }
  }
  return problems;
}

/**
 * Decision numbers on origin/main, fetched first, so a checkout or worktree made before someone
 * else's push still numbers past theirs. Offline, or outside git, it's none.
 */
function numbersOnMain(dir: string): number[] {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    git("fetch", "--quiet", "origin", "main");
  } catch {
    // Offline: origin/main as last fetched.
  }
  try {
    return git("ls-tree", "--name-only", "origin/main", `${relative(ROOT, dir)}/`)
      .split("\n")
      .map((path) => Number.parseInt(path.slice(path.lastIndexOf("/") + 1), 10))
      .filter((n) => !Number.isNaN(n));
  } catch {
    return [];
  }
}

function renderIndex(entries: Entry[]): string {
  const lines = [
    "# Knowledge index",
    "",
    "<!-- Generated by `pnpm kb`. Do not edit by hand; CI fails if this is stale. -->",
    "",
    "Start here. How this works: [README.md](README.md).",
    "",
  ];
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const { heading, blurb } = KINDS[kind];
    const list = entries.filter((e) => e.kind === kind);
    lines.push(`## ${heading}`, "", blurb, "");
    if (list.length === 0) lines.push("_None yet._", "");
    else {
      // Handoffs: newest first, since the latest one is the one you need. Filenames start with
      // YYYY-MM-DD-HHMM, so filename order is creation order.
      if (kind === "handoff") list.reverse();
      for (const e of list) {
        const status = e.status ? ` · ${e.status}` : "";
        const tags = e.tags.length ? ` · ${e.tags.map((t) => `\`${t}\``).join(" ")}` : "";
        lines.push(`- [${e.title}](${e.file}) · ${e.date}${status}${tags}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function create(kind: Kind, title: string) {
  const dir = join(KB, KINDS[kind].dir);
  const template = readFileSync(join(dir, "TEMPLATE.md"), "utf8");
  let name: string;
  if (kind === "decision") {
    const numbers = [
      ...readdirSync(dir)
        .map((f) => Number.parseInt(f, 10))
        .filter((n) => !Number.isNaN(n)),
      ...numbersOnMain(dir),
    ];
    const next = String(Math.max(0, ...numbers) + 1).padStart(4, "0");
    name = `${next}-${slugify(title)}.md`;
  } else if (kind === "handoff") {
    // Time in the name keeps several handoffs on one day in order.
    const hhmm = new Date().toISOString().slice(11, 16).replace(":", "");
    name = `${today()}-${hhmm}-${slugify(title)}.md`;
  } else {
    name = `${today()}-${slugify(title)}.md`;
  }
  const file = join(dir, name);
  if (existsSync(file)) throw new Error(`${relative(ROOT, file)} already exists`);
  const fill: Record<string, string> = { title, date: today() };
  writeFileSync(
    file,
    template.replace(/\{\{(title|date)\}\}/g, (_, key: string) => fill[key] ?? ""),
  );
  console.log(relative(ROOT, file));
}

const [cmd, kind, ...titleWords] = process.argv.slice(2);

if (cmd === "new") {
  if (!kind || !Object.hasOwn(KINDS, kind) || titleWords.length === 0) {
    console.error('Usage: pnpm kb new <decision|learning|handoff> "Title"');
    process.exit(1);
  }
  create(kind as Kind, titleWords.join(" "));
}

const { entries, problems } = load();
if (problems.length) {
  console.error(`Knowledge base problems:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
const index = renderIndex(entries);
if (cmd === "--check") {
  const current = existsSync(INDEX) ? readFileSync(INDEX, "utf8") : "";
  if (current !== index) {
    console.error("docs/knowledge/INDEX.md is stale. Run `pnpm kb` and commit the result.");
    process.exit(1);
  }
  console.log(`Knowledge index OK (${entries.length} entries).`);
} else {
  writeFileSync(INDEX, index);
  console.log(`Wrote docs/knowledge/INDEX.md (${entries.length} entries).`);
}
