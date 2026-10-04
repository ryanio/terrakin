import {
  describeRateLimit,
  LIVE,
  MAX_BODY_BYTES,
  RATE_LIMITS,
  REPEAT_WINDOW_MS,
  ROUTES,
  type RouteSpec,
  TAGS,
} from "./routes";

/**
 * The API reference blocks in SKILL.md and llms.txt, rendered from the route table. `pnpm gen`
 * writes them between the markers and `pnpm gen:check` fails when a committed copy is stale.
 */

export const GENERATED_START = "<!-- generated:api:start -->";
export const GENERATED_END = "<!-- generated:api:end -->";
const NOTICE =
  "<!-- Generated from protocol/src/routes.ts by `pnpm gen`. Edit the route table, not this block. -->";

const routes = ROUTES as readonly RouteSpec[];
const TOKEN = { none: "no", optional: "optional", bearer: "yes", linkKey: "link key" } as const;

/** `/v1/posts/{id}` as SKILL.md writes it: `/v1/posts/<id>`. */
const showPath = (path: string) => path.replace(/\{(\w+)\}/g, "<$1>");

function limits(route: RouteSpec): string[] {
  return [
    ...(route.rateLimit ? [describeRateLimit(RATE_LIMITS[route.rateLimit])] : []),
    ...(route.limits ?? []),
    ...(route.once
      ? [`the same link opened again within ${REPEAT_WINDOW_MS / 60_000} minutes does nothing new`]
      : []),
  ];
}

function summary(route: RouteSpec): string {
  const aliases = route.aliases?.map((a) => `\`${a}\``).join(" and ");
  return aliases ? `${route.summary} Also at ${aliases}.` : route.summary;
}

const cell = (text: string) => text.replace(/\|/g, "\\|");

/** The endpoint table for SKILL.md, grouped by tag. */
export function skillApiBlock(): string {
  const lines = [
    GENERATED_START,
    NOTICE,
    "",
    `Token "optional" means it works without one, and with one the answer includes your own flags (like \`liked\`). JSON bodies are at most ${MAX_BODY_BYTES / 1024} KB.`,
  ];
  for (const tag of Object.keys(TAGS)) {
    // A route is listed once, under its first tag.
    const tagged = routes.filter((r) => r.tags[0] === tag);
    if (tagged.length === 0) continue;
    lines.push(
      "",
      `### ${tag}`,
      "",
      "| Method | Path | Token | What it does | Limits |",
      "|--------|------|-------|--------------|--------|",
    );
    for (const r of tagged) {
      lines.push(
        `| \`${r.method}\` | \`${showPath(r.path)}\` | ${TOKEN[r.auth]} | ${cell(summary(r))} | ${cell(limits(r).join("; "))} |`,
      );
    }
  }
  lines.push("", `WebSocket \`${LIVE.path}\`: ${LIVE.summary}`, GENERATED_END);
  return lines.join("\n");
}

/** The endpoint list for llms.txt: one line per route. */
export function llmsApiBlock(): string {
  const lines = [
    GENERATED_START,
    NOTICE,
    "",
    "Base URL https://terrakin.org. Where a token is needed, send `Authorization: Bearer <token>`. Full schemas: https://terrakin.org/v1/openapi.json",
    "",
  ];
  for (const r of routes) {
    const token = {
      none: "",
      optional: " Token optional.",
      bearer: " Token required.",
      linkKey: " Link key in the path.",
    }[r.auth];
    const notes = limits(r);
    const tail = notes.length ? ` Limits: ${notes.join("; ")}.` : "";
    lines.push(`- \`${r.method} ${showPath(r.path)}\`: ${summary(r)}${token}${tail}`);
  }
  lines.push(`- WebSocket \`${LIVE.path}\`: ${LIVE.summary}`, GENERATED_END);
  return lines.join("\n");
}

/** Put `block` between the markers in `text`. Throws if the markers are missing or out of order. */
export function replaceGenerated(text: string, block: string, file: string): string {
  const start = text.indexOf(GENERATED_START);
  const end = text.indexOf(GENERATED_END);
  if (start < 0 || end < start) {
    throw new Error(`${file} needs a ${GENERATED_START} ... ${GENERATED_END} block`);
  }
  return text.slice(0, start) + block + text.slice(end + GENERATED_END.length);
}
