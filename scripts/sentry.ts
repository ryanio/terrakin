/**
 * Read Terrakin's Sentry from the terminal, for investigating production (decision 0037).
 *
 *   node scripts/sentry.ts issues [days]       unresolved issues in both projects, newest first
 *   node scripts/sentry.ts issue <id|SHORT-ID> the latest event: stack, breadcrumbs, tags, trace
 *   node scripts/sentry.ts trace <trace id>    the spans of one trace, slowest first
 *
 * The auth token is SENTRY_AUTH_TOKEN, or the `sentry` item's credential in the Terrakin vault,
 * read through the secrets wrapper (never the `op` binary).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ORG = "terrakin";
const API = "https://sentry.io/api/0";

function token(): string {
  const fromEnv = process.env.SENTRY_AUTH_TOKEN;
  if (fromEnv) return fromEnv;
  const wrapper = fileURLToPath(new URL("../.agents/skills/secrets/1p.mjs", import.meta.url));
  return execFileSync("node", [wrapper, "get", "sentry", "credential"], {
    encoding: "utf8",
  }).trim();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, { headers: { authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`Sentry answered ${res.status} for ${path}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Issue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  project: { slug: string };
  permalink: string;
}

interface Frame {
  filename: string | null;
  function: string | null;
  lineNo: number | null;
  colNo: number | null;
  inApp: boolean;
}

interface Entry {
  type: string;
  data: {
    values?: {
      type?: string;
      value?: string;
      stacktrace?: { frames: Frame[] } | null;
      category?: string;
      message?: string | null;
      data?: Record<string, unknown> | null;
      timestamp?: string;
    }[];
  };
}

interface Event {
  eventID: string;
  dateCreated: string;
  release: { version: string } | null;
  tags: { key: string; value: string }[];
  contexts: { trace?: { trace_id?: string } };
  entries: Entry[];
}

async function issues(days: string) {
  const list = await get<Issue[]>(
    `organizations/${ORG}/issues/?query=is:unresolved&statsPeriod=${Number(days) || 14}d&sort=date&limit=25`,
  );
  if (list.length === 0) console.log("No unresolved issues.");
  for (const i of list) {
    console.log(`${i.shortId}  ${i.project.slug}  x${i.count}  last ${i.lastSeen}`);
    console.log(`  ${i.title}${i.culprit ? `  (${i.culprit})` : ""}`);
  }
}

async function issue(ref: string) {
  const found = /^\d+$/.test(ref)
    ? await get<Issue>(`organizations/${ORG}/issues/${ref}/`)
    : (await get<{ group: Issue }>(`organizations/${ORG}/shortids/${ref}/`)).group;
  const event = await get<Event>(`organizations/${ORG}/issues/${found.id}/events/latest/`);
  console.log(`${found.shortId}  ${found.project.slug}  x${found.count}`);
  console.log(found.title);
  console.log(`first ${found.firstSeen}  last ${found.lastSeen}  ${found.permalink}`);
  console.log(
    `event ${event.eventID} at ${event.dateCreated}, release ${event.release?.version ?? "?"}`,
  );
  const traceId = event.contexts.trace?.trace_id;
  if (traceId) console.log(`trace ${traceId}  (node scripts/sentry.ts trace ${traceId})`);
  console.log(`tags ${event.tags.map((t) => `${t.key}=${t.value}`).join(" ")}`);
  for (const entry of event.entries) {
    if (entry.type === "exception") {
      for (const ex of entry.data.values ?? []) {
        console.log(`\n${ex.type}: ${ex.value}`);
        const frames = ex.stacktrace?.frames ?? [];
        for (const f of frames.slice(-12).reverse()) {
          const where = `${f.filename ?? "?"}:${f.lineNo ?? "?"}:${f.colNo ?? "?"}`;
          console.log(`  ${f.inApp ? "*" : " "} ${f.function ?? "<anonymous>"}  ${where}`);
        }
      }
    }
    if (entry.type === "breadcrumbs") {
      console.log("\nbreadcrumbs, oldest first:");
      for (const b of (entry.data.values ?? []).slice(-25)) {
        const data = b.data ? ` ${JSON.stringify(b.data)}` : "";
        console.log(`  ${b.timestamp ?? ""} [${b.category ?? "?"}] ${b.message ?? ""}${data}`);
      }
    }
  }
}

interface SpanRow {
  "span.op": string;
  "span.description": string;
  "span.duration": number;
  project: string;
  timestamp: string;
}

async function trace(traceId: string) {
  const fields = ["span.op", "span.description", "span.duration", "project", "timestamp"];
  const query = new URLSearchParams({
    dataset: "spans",
    query: `trace:${traceId}`,
    sort: "-span.duration",
    per_page: "50",
    statsPeriod: "14d",
  });
  for (const f of fields) query.append("field", f);
  const { data } = await get<{ data: SpanRow[] }>(`organizations/${ORG}/events/?${query}`);
  if (data.length === 0)
    console.log("No spans for that trace (not sampled, or older than 14 days).");
  for (const s of data) {
    console.log(
      `${s["span.duration"].toFixed(1).padStart(8)} ms  ${s.project}  ${s["span.op"]}  ${s["span.description"]}`,
    );
  }
}

const [command, arg] = process.argv.slice(2);
if (command === "issues") await issues(arg ?? "14");
else if (command === "issue" && arg) await issue(arg);
else if (command === "trace" && arg) await trace(arg);
else {
  console.log(
    "Usage: node scripts/sentry.ts issues [days] | issue <id|SHORT-ID> | trace <trace id>",
  );
  process.exitCode = 1;
}
