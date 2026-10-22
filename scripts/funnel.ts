/**
 * The dated newcomer funnel read in one command: the staff API's `GET /v1/admin/newcomers`
 * (decision 0141), the counts the staff app's Newcomers page shows, printed as Markdown ready for a
 * handoff. It reads counts only, no names, ids, or text.
 *
 *   node --import ./scripts/resolve-ts.mjs scripts/funnel.ts [--base https://terrakin.org]
 *                                                            [--save before.json]
 *                                                            [--since before.json]
 *
 * It signs in with `TERRAKIN_STAFF_KEY`, a staff key sent as a bearer token (docs/staff-agents.md),
 * and never over plain http to a host that isn't this machine. `--save` writes the read to a file,
 * and `--since` prints what changed from a read saved earlier: save one before an event and read
 * with `--since` after it.
 *
 * Exit codes: 0 it read the funnel, 2 it couldn't (no key, a refusal, a saved read it can't use).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  cohortTitle,
  hearthThingLine,
  NEWCOMER_ROWS,
  sameNameLine,
  stepShare,
} from "../packages/admin/src/logic.ts";
import { type NewcomerCounts, NewcomersResponse } from "../packages/protocol/src/index.ts";

/** A read, with when it was made, as `--save` writes it and `--since` reads it back. */
export interface SavedRead {
  readAt: string;
  base: string;
  funnel: NewcomersResponse;
}

const cell = (counts: NewcomerCounts, key: keyof NewcomerCounts) => {
  const { count, share } = stepShare(counts, key);
  return share ? `${count} (${share})` : count;
};

/** A table of every step, people beside AIs, each with its share of the cohort's joins. */
function stepTable(people: NewcomerCounts, agents: NewcomerCounts): string[] {
  return [
    `| Step | People (${people.joined}) | AIs (${agents.joined}) |`,
    "|---|---|---|",
    ...NEWCOMER_ROWS.filter((r) => r.key !== "joined").map(
      (r) => `| ${r.label} | ${cell(people, r.key)} | ${cell(agents, r.key)} |`,
    ),
  ];
}

/** One line for a week: its joins, then each step as people / AIs. */
function weekLine(c: NewcomersResponse["weeks"][number], today: string): string {
  const { people, agents } = c;
  const steps = NEWCOMER_ROWS.filter((r) => r.key !== "joined").map(
    (r) => `${r.label.toLowerCase()} ${people[r.key]} / ${agents[r.key]}`,
  );
  const joined = people.joined + agents.joined;
  return `- ${cohortTitle(c.week, today)}: ${joined} joined (${people.joined} people, ${agents.joined} AIs). ${steps.join(", ")}.`;
}

/** The whole read: all time as a table, the hearth-and-thing line, then every week anyone joined. */
export function funnelReport(f: NewcomersResponse, where: string): string {
  const { people, agents } = f.allTime;
  const lines = [
    `## The newcomer funnel, read ${f.today}`,
    "",
    `From \`GET /v1/admin/newcomers\` on ${where}. Every count is "ever did this, in any order", townsfolk left out.`,
    "",
    `All time, ${people.joined + agents.joined} joined, ${people.joined} people and ${agents.joined} AIs${f.undated ? `, ${f.undated} of them from before the world counted days` : ""}.`,
    "",
    ...stepTable(people, agents),
    "",
  ];
  const extra = [
    hearthThingLine(people, "people"),
    hearthThingLine(agents, "AIs"),
    sameNameLine(f.allTime.sameName),
  ].filter((l): l is string => l !== null);
  if (extra.length) lines.push(...extra, "");
  const weeks = f.weeks.filter((w) => w.people.joined + w.agents.joined > 0);
  if (weeks.length)
    lines.push(
      "By the week people joined, people / AIs:",
      "",
      ...weeks.map((w) => weekLine(w, f.today)),
    );
  return lines.join("\n");
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** One side's change in a step, with its share of the side's new joins once anyone joined. */
function change(before: NewcomerCounts, after: NewcomerCounts, key: keyof NewcomerCounts) {
  const d = after[key] - before[key];
  const joined = after.joined - before.joined;
  if (key === "joined" || joined <= 0) return signed(d);
  return `${signed(d)} (${Math.round((100 * d) / joined)}% of ${joined})`;
}

/**
 * What changed between two reads, all time against all time: who joined in between, and how many
 * more reached each step. A step can also move for someone who joined before, so the share beside
 * each is of the new joins and an upper bound, close to exact over an hour.
 */
export function funnelSince(before: SavedRead, after: NewcomersResponse): string {
  const b = before.funnel.allTime;
  const a = after.allTime;
  return [
    `## The newcomer funnel since ${before.readAt}`,
    "",
    `All-time counts on ${before.base}, then (${before.funnel.today}) against now (${after.today}). Each step counts everyone who reached it in between, which is almost always someone who joined in between, so the share beside it is of the new joins.`,
    "",
    "| Step | People | AIs |",
    "|---|---|---|",
    ...NEWCOMER_ROWS.map(
      (r) =>
        `| ${r.label} | ${change(b.people, a.people, r.key)} | ${change(b.agents, a.agents, r.key)} |`,
    ),
    `| Has a hearth and a first thing | ${change(b.people, a.people, "hearthAndThing")} | ${change(b.agents, a.agents, "hearthAndThing")} |`,
  ].join("\n");
}

/** Whether `base` is this machine, where a plain http server is fine. */
const isLocal = (base: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(base);

/** Why the read can't go out, or undefined when it can. */
export function cantSend(base: string, key: string | undefined): string | undefined {
  if (!key) {
    return "No staff key. Set TERRAKIN_STAFF_KEY, for example: node .agents/skills/secrets/1p.mjs run --only TERRAKIN_STAFF_KEY -- pnpm funnel";
  }
  if (!base.startsWith("https://") && !isLocal(base)) {
    return `Not sending a staff key over plain http to ${base}.`;
  }
  return undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "https://terrakin.org" },
      save: { type: "string" },
      since: { type: "string" },
    },
  });
  const base = values.base.replace(/\/$/, "");
  const key = process.env.TERRAKIN_STAFF_KEY?.trim();
  const why = cantSend(base, key);
  if (why) fail(why);
  let before: SavedRead | undefined;
  if (values.since) {
    try {
      before = JSON.parse(readFileSync(values.since, "utf8")) as SavedRead;
      before.funnel = NewcomersResponse.parse(before.funnel);
    } catch (err) {
      fail(
        `Couldn't use the saved read ${values.since}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  let funnel: NewcomersResponse;
  try {
    const res = await fetch(`${base}/v1/admin/newcomers`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`GET /v1/admin/newcomers answered ${res.status}`);
    funnel = NewcomersResponse.parse(await res.json());
  } catch (err) {
    fail(`Couldn't read the funnel: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(before ? funnelSince(before, funnel) : funnelReport(funnel, base));
  if (values.save) {
    const saved: SavedRead = { readAt: new Date().toISOString(), base, funnel };
    writeFileSync(values.save, `${JSON.stringify(saved, null, 2)}\n`);
    console.error(`Saved this read to ${values.save}.`);
  }
}
