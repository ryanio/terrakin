/**
 * The REST calls are one module for each area of the API in `src/api/`, and a page that loads
 * lazily imports its own area's (decision 0258). The first load is main.ts and everything it
 * imports up front, so an area imported there puts its response schemas in every visit. This
 * fails when the first load gains an area, long before the build's budget would notice.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const src = import.meta.dirname;

/** The areas the feed, the top bar, and the router ask. */
const FIRST_LOAD_AREAS = [
  "devlog",
  "events",
  "letters",
  "me",
  "media",
  "notifications",
  "plots",
  "posts",
  "purse",
  "reports",
  "request",
  "residents",
  "routines",
  "town",
  "world",
];

/** The app's own files `file` imports up front: not its type imports, and not its `import()`s. */
function importedUpFront(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specifiers = [
    ...[...text.matchAll(/^(?:import|export) (type )?[^;]*?from "(\.[^"]+)";/gms)]
      .filter((m) => m[1] === undefined)
      .map((m) => m[2] ?? ""),
    ...[...text.matchAll(/^import "(\.[^"]+)";/gm)].map((m) => m[1] ?? ""),
  ];
  return specifiers
    .map((specifier) => `${join(dirname(file), specifier)}.ts`)
    .filter((path) => existsSync(path));
}

/** Each area of the API the first load reaches, with the file that imports it. */
function areasInFirstLoad(): Map<string, string> {
  const areas = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [join(src, "main.ts")];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of importedUpFront(file)) {
      const area = relative(join(src, "api"), next);
      if (!area.startsWith("..") && !areas.has(area)) areas.set(area, relative(src, file));
      queue.push(next);
    }
  }
  // A walk that finds nothing would pass.
  if (!seen.has(join(src, "feed-view.ts"))) throw new Error("the walk never reached the feed");
  return areas;
}

describe("the first load's API calls", () => {
  it("are the feed's and the top bar's areas, and no lazy page's", () => {
    const found = [...areasInFirstLoad()].map(([area, by]) => ({
      area: area.replace(/\.ts$/, ""),
      by,
    }));
    const extra = found
      .filter(({ area }) => !FIRST_LOAD_AREAS.includes(area))
      .map(({ area, by }) => `${by} imports api/${area}: import it from the lazy page instead`);
    expect(extra).toEqual([]);
    const gone = FIRST_LOAD_AREAS.filter((area) => !found.some((f) => f.area === area));
    expect(gone, "no longer in the first load: take these off FIRST_LOAD_AREAS").toEqual([]);
  });
});
